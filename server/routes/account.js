// account 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，server.mjs 中的调用点顺序不可调整。
import {
  AUTH_COOKIE_NAME, VERIFICATION_CODE_TTL_MS, oauthAuthorizeUrl, oauthClientId, smtpFrom,
  smtpFromName, tencentSmsBindTemplateId, testVerificationDebugMode
} from '../config.js'

import {
  createToken, httpError
} from '../lib/http.js'

import {
  accountRecordOwnerKey, mergeLoginMethods, normalizeAccountRecords, normalizeEmailValue,
  normalizeFileCleanupSettings, normalizeNotificationSettings, normalizePhoneValue
} from '../lib/metadata-normalizers.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountMessagesForUser, accountNotificationSettingsForUser, accountRecordsForUser,
  accountUserById, alignReturnUrlWithAuthHost, appendAuthResult, authRedirectUri,
  authSessionFromRequest, boundMethodForTargetType, cleanupOAuthStates, clearAuthCookie,
  createVerificationCode, discardVerificationCode, findAccountUserByTarget,
  getEmailTransporter, isOAuthConfigured, isTencentSmsConfigured, mailErrorReason,
  mergeAccountRecords, normalizeContactTarget, pruneOrphanRecordEntries, publicAccountUser,
  purgeOwnedStaleResource, readCookie, removeAuthSession, requireAuthSession, safeReturnUrl,
  sendTencentSmsCode, syncAccountUserSessions, syncOrganizationMemberProfile,
  updateFileCleanupSettings, upsertAccountUser, verificationSendBlocked, verifyAuthCode
} from '../services/account.js'

import {
  oauthStates
} from '../state.js'
export function registerAccountRoutes(app) {
  app.get('/api/auth/login', (req, res) => {
    let returnTo = safeReturnUrl('', req)
    try {
      returnTo = safeReturnUrl(req.query.return_to, req)
      if (!isOAuthConfigured()) {
        return res.redirect(appendAuthResult(returnTo, 'failed', '登录服务未配置'))
      }

      cleanupOAuthStates()
      const state = createToken(32)
      const redirectUri = authRedirectUri(req)
      returnTo = alignReturnUrlWithAuthHost(returnTo, redirectUri)
      oauthStates.set(state, { redirectUri, returnTo, createdAt: Date.now() })

      const loginUrl = new URL(oauthAuthorizeUrl)
      loginUrl.searchParams.set('client_id', oauthClientId)
      loginUrl.searchParams.set('redirect_uri', redirectUri)
      loginUrl.searchParams.set('response_type', 'code')
      loginUrl.searchParams.set('state', state)
      return res.redirect(loginUrl.toString())
    } catch (error) {
      console.error('OAuth login redirect failed:', error)
      return res.redirect(appendAuthResult(returnTo, 'failed', '登录服务暂时不可用，请稍后重试'))
    }
  })
  app.get('/api/auth/me', (req, res) => {
    const session = authSessionFromRequest(req)
    res.json({ user: session ? publicAccountUser(session.user) : null })
  })
  app.patch('/api/auth/profile', (req, res) => {
    const session = authSessionFromRequest(req)
    if (!session) return res.status(401).json({ message: '请先登录' })

    const body = req.body || {}
    const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname')
    const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
    if (!hasNickname && !hasAvatar) return res.status(400).json({ message: '没有可保存的资料' })

    // ⚠️ session.user 是**快照**，可能已经落后于用户表（例如这次登录后另一台设备刚改过头像）。
    // 用快照整体覆盖 upsertAccountUser 会把过期的 avatar / avatarSource 一并写回，
    // 造成"保存昵称顺手把头像改没了"或"恢复登录头像不生效"。
    // 因此这里始终以**用户表**为准来做合并。
    const stored = accountUserById(session.user.id) || {}
    const patch = { ...stored }

    if (hasNickname) {
      const nickname = String(body.nickname || '').trim()
      if (!nickname) return res.status(400).json({ message: '昵称不能为空' })
      if (nickname.length > 40) return res.status(400).json({ message: '昵称最多 40 个字符' })
      patch.nickname = nickname
    }
    if (hasAvatar) {
      const avatar = body.avatar === null ? null : String(body.avatar || '')
      if (avatar && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 600000)) {
        return res.status(400).json({ message: '头像格式不支持或图片过大，请上传 600 KB 以内的图片' })
      }
      // 显式写入 avatar 与 avatarSource，mergeAccountUser 才会认为"用户表了态"：
      // avatar 有值 → custom；avatar 为 null → 恢复登录头像（回落 provider）。
      const providerAvatar = stored.providerAvatar || session.user.providerAvatar || null
      patch.avatar = avatar || providerAvatar || null
      if (avatar) {
        patch.avatarSource = 'custom'
      } else {
        // 「恢复登录头像」：必须显式清空 avatarSource，并带上一个可识别的标记，
        // 否则 mergeAccountUser 会把这次操作误判成"没有表态的旧快照"而保留 custom。
        patch.avatarSource = ''
        patch.avatarRestoreRequested = true
      }
    }

    const user = upsertAccountUser(patch)
    syncAccountUserSessions(user)
    // 改名/换头像后同步团队 roster，否则团队空间会一直显示入团时的旧快照。
    syncOrganizationMemberProfile(user)
    persistMetadata()
    res.json({ user: publicAccountUser(user) })
  })
  app.get('/api/account/file-cleanup-settings', (req, res) => {
    const session = authSessionFromRequest(req)
    if (!session) return res.status(401).json({ message: '请先登录' })
    res.json({ settings: normalizeFileCleanupSettings(accountUserById(session.user.id)?.fileCleanup || session.user.fileCleanup) })
  })
  app.put('/api/account/file-cleanup-settings', updateFileCleanupSettings)
  app.patch('/api/account/file-cleanup-settings', updateFileCleanupSettings)
  app.post('/api/account/file-cleanup-settings', updateFileCleanupSettings)
  app.post('/api/auth/code', async (req, res) => {
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const target = normalizeContactTarget(req.body?.target)
      if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
      const blockedMessage = verificationSendBlocked(target, req)
      if (blockedMessage) return res.status(429).json({ message: blockedMessage })
      const debugCode = createVerificationCode(target, 'bind')
      if (target.type === 'email') {
        const transporter = getEmailTransporter()
        if (!transporter) {
          if (testVerificationDebugMode) {
            return res.status(201).json({
              ok: true,
              channel: 'email',
              debugCode,
              expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
              message: '测试环境未配置 SMTP，已生成演示验证码。',
            })
          }
          discardVerificationCode(target, 'bind')
          return res.status(503).json({ message: '邮箱 SMTP 服务未配置，暂时无法发送验证码' })
        }
        try {
          await transporter.sendMail({
            from: { name: smtpFromName || '鲲穹文件传输', address: smtpFrom },
            to: target.value,
            subject: '鲲穹文件传输邮箱绑定验证码',
            text: `你的鲲穹文件传输邮箱绑定验证码是：${debugCode}。验证码 10 分钟内有效，请勿泄露给他人。`,
            html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#243b35;line-height:1.7;"><h2 style="margin:0 0 16px;">绑定邮箱验证码</h2><p>你的鲲穹文件传输邮箱绑定验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#128c73;">${debugCode}</p><p style="color:#74877f;">验证码 10 分钟内有效，请勿泄露给他人。</p></div>`,
          })
        } catch (error) {
          if (testVerificationDebugMode) {
            return res.status(201).json({
              ok: true,
              channel: 'email',
              debugCode,
              expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
              message: `测试环境邮件投递失败，已生成演示验证码（${mailErrorReason(error)}）。`,
            })
          }
          discardVerificationCode(target, 'bind')
          throw httpError(502, `验证码邮件发送失败：${mailErrorReason(error)}`)
        }
        return res.status(201).json({
          ok: true,
          channel: 'email',
          expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
          message: '验证码已发送至你的邮箱，请查收邮件。',
        })
      }
      if (!isTencentSmsConfigured()) {
        if (testVerificationDebugMode) {
          return res.status(201).json({
            ok: true,
            channel: 'sms',
            debugCode,
            expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
            message: '测试环境未配置短信服务，已生成演示验证码。',
          })
        }
        discardVerificationCode(target, 'bind')
        return res.status(503).json({ message: '短信服务未配置，暂时无法发送验证码' })
      }
      try {
        await sendTencentSmsCode(target.value, debugCode, tencentSmsBindTemplateId)
      } catch (error) {
        if (testVerificationDebugMode) {
          return res.status(201).json({
            ok: true,
            channel: 'sms',
            debugCode,
            expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
            message: `测试环境短信投递失败，已生成演示验证码（${error.message || '腾讯云短信服务异常'}）。`,
          })
        }
        discardVerificationCode(target, 'bind')
        throw httpError(502, `验证码短信发送失败：${error.message || '腾讯云短信服务异常'}`)
      }
      res.status(201).json({
        ok: true,
        channel: 'sms',
        expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
        message: '验证码已发送至你的手机，请查收短信。',
      })
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || '验证码生成失败' })
    }
  })
  app.post('/api/account/bind', (req, res) => {
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const target = normalizeContactTarget(req.body?.target)
      if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
      verifyAuthCode(target, req.body?.code, 'bind')
      const existingUser = findAccountUserByTarget(target)
      const boundByAnotherAccount = Object.values(metadata.users || {}).some((user) => (
        user.id !== session.user.id
        && (target.type === 'email'
          ? normalizeEmailValue(user.email) === target.value
          : normalizePhoneValue(user.phone) === target.value)
      ))
      if ((existingUser && existingUser.id !== session.user.id) || boundByAnotherAccount) {
        return res.status(409).json({ message: target.type === 'email' ? '该邮箱已绑定其他账号' : '该手机号已绑定其他账号' })
      }
      // 同样以用户表为准：绑定手机/邮箱不应把 session 快照里可能过期的头像写回去。
      const stored = accountUserById(session.user.id) || session.user
      const user = upsertAccountUser({
        ...stored,
        [target.type]: target.value,
        loginMethods: mergeLoginMethods(stored.loginMethods, [boundMethodForTargetType(target.type)]),
      })
      syncAccountUserSessions(user)
      persistMetadata()
      res.json({ user: publicAccountUser(user) })
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || '账号绑定失败' })
    }
  })
  app.post('/api/auth/logout', (req, res) => {
    const sessionId = readCookie(req, AUTH_COOKIE_NAME)
    if (sessionId) removeAuthSession(sessionId)
    clearAuthCookie(res, req)
    res.json({ ok: true })
  })
  app.get('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    res.json({ records: accountRecordsForUser(session.user.id) })
  })
  app.put('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    metadata.records[key] = pruneOrphanRecordEntries(normalizeAccountRecords(req.body?.records))
    persistMetadata()
    res.json({ records: metadata.records[key] })
  })
  app.post('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const body = req.body || {}
    const incoming = Array.isArray(body.records) ? body.records : body.record ? [body.record] : []
    if (!incoming.length) return res.status(400).json({ message: '没有可同步的记录' })
    const key = accountRecordOwnerKey(session.user.id)
    metadata.records[key] = mergeAccountRecords(accountRecordsForUser(session.user.id), incoming)
    persistMetadata()
    res.status(201).json({ records: metadata.records[key] })
  })
  app.delete('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    // 记录联动清理：删除记录时，把该用户名下「已关闭/过期」的底层分享/收集任务连同磁盘文件一并清掉，
    // 否则记录删了、后台统计和磁盘上还挂着僵尸资源（后台「分享/收集任务/待清理」不同步的根源）。
    // 仍在有效期的资源照旧保留，对方的提取链接不受影响。
    const purged = []
    if (ids.length) {
      const targets = new Set(ids)
      for (const id of ids) {
        const purgedResource = purgeOwnedStaleResource(session.user.id, id)
        if (purgedResource) purged.push(purgedResource)
      }
      metadata.records[key] = accountRecordsForUser(session.user.id).filter((record) => !targets.has(record.id))
    } else {
      for (const record of accountRecordsForUser(session.user.id)) {
        const purgedResource = purgeOwnedStaleResource(session.user.id, record.id)
        if (purgedResource) purged.push(purgedResource)
      }
      metadata.records[key] = []
    }
    persistMetadata()
    res.json({ records: metadata.records[key], purged })
  })
  app.get('/api/account/messages', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    res.json({ messages: accountMessagesForUser(session.user.id), settings: accountNotificationSettingsForUser(session.user.id) })
  })
  app.patch('/api/account/messages', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    metadata.messages[key] = accountMessagesForUser(session.user.id).map((message) => ({ ...message, unread: false }))
    persistMetadata()
    res.json({ messages: metadata.messages[key] })
  })
  app.delete('/api/account/messages', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    metadata.messages[key] = []
    persistMetadata()
    res.json({ messages: metadata.messages[key] })
  })
  app.patch('/api/account/messages/:messageId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const messages = accountMessagesForUser(session.user.id)
    const message = messages.find((item) => item.id === req.params.messageId)
    if (!message) return res.status(404).json({ message: '消息不存在' })
    message.unread = false
    message.readAt = new Date().toISOString()
    persistMetadata()
    res.json({ message, messages })
  })
  app.delete('/api/account/messages/:messageId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    metadata.messages[key] = accountMessagesForUser(session.user.id).filter((message) => message.id !== req.params.messageId)
    persistMetadata()
    res.json({ messages: metadata.messages[key] })
  })
  app.get('/api/account/notification-settings', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    res.json({ settings: accountNotificationSettingsForUser(session.user.id) })
  })
  app.put('/api/account/notification-settings', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    metadata.notificationSettings[key] = normalizeNotificationSettings(req.body?.settings)
    persistMetadata()
    res.json({ settings: metadata.notificationSettings[key] })
  })
}
