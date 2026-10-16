import { localRequest } from '../lib/request-security.js'
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
import { keyedDigest } from '../lib/private-key.js'

import {
  accountRecordOwnerKey, mergeLoginMethods, normalizeAccountRecords,
  normalizeFileCleanupSettings
} from '../lib/metadata-normalizers.js'
import { normalizeBindingTarget } from '../lib/contact-input.js'
import { booleanSettings, objectInput, recordInputs, textInput } from '../lib/input-validation.js'
import { normalizeAvatarData } from '../lib/avatar-validation.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountMessagesForUser, accountNotificationSettingsForUser, accountRecordsForUser,
  accountUserById, alignReturnUrlWithAuthHost, appendAuthResult, authRedirectUri,
  authSessionFromRequest, boundMethodForTargetType, cleanupOAuthStates, clearAuthCookie,
  createVerificationCode, discardVerificationCode, assertContactAvailable,
  getEmailTransporter, isOAuthConfigured, isTencentSmsConfigured, mailErrorReason,
  mergeAccountRecords, pruneOrphanRecordEntries, publicAccountUser,
  purgeOwnedStaleResource, readCookie, removeAuthSession, requireAuthSession, safeReturnUrl,
  sendTencentSmsCode, syncAccountUserSessions, syncOrganizationMemberProfile,
  updateFileCleanupSettings, upsertAccountUser, verificationSendBlocked, verifyAuthCode,
  getRequestOrigin, setOAuthStateCookie
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
      const redirectUri = authRedirectUri(req)
      returnTo = alignReturnUrlWithAuthHost(returnTo, redirectUri)
      // localhost 与 127.0.0.1 不共享 Cookie。先对齐登录发起地址，再生成浏览器绑定。
      const requestUrl = new URL(req.originalUrl, getRequestOrigin(req))
      const callbackHost = new URL(redirectUri).hostname
      const alignedUrl = new URL(alignReturnUrlWithAuthHost(requestUrl.toString(), redirectUri))
      if (alignedUrl.hostname !== requestUrl.hostname && alignedUrl.hostname === callbackHost) {
        alignedUrl.searchParams.set('return_to', returnTo)
        return res.redirect(alignedUrl.toString())
      }
      const state = createToken(32)
      const browserNonce = createToken(48)
      oauthStates.set(state, { redirectUri, returnTo, browserHash: keyedDigest(browserNonce), createdAt: Date.now() })
      setOAuthStateCookie(res, req, state, browserNonce)

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
    res.json({ user: session ? publicAccountUser(session.user) : null, sessionExpiresAt: session?.expiresAt || null })
  })

  app.patch('/api/auth/profile', async (req, res, next) => {
    try {
      const session = authSessionFromRequest(req)
      if (!session) return res.status(401).json({ message: '请先登录' })

      const body = objectInput(req.body, ['nickname', 'avatar'], { nonempty: true })
      const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname')
      const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
      if (!hasNickname && !hasAvatar) return res.status(400).json({ message: '没有可保存的资料' })

      const nickname = hasNickname ? textInput(body.nickname, '昵称', 40) : undefined
      const avatar = hasAvatar ? await normalizeAvatarData(body.avatar === null ? '' : body.avatar) : undefined
      // 解码会让出事件循环：再次检查会话，再读取最新资料，避免覆盖并发保存。
      const currentSession = authSessionFromRequest(req)
      if (!currentSession || currentSession.user.id !== session.user.id) return res.status(401).json({ message: '登录已失效，请重新登录' })
      const stored = accountUserById(currentSession.user.id) || currentSession.user
      const patch = { ...stored }
      if (hasNickname) patch.nickname = nickname
      if (hasAvatar) {
        // 显式写入 avatar 与 avatarSource，mergeAccountUser 才会认为"用户表了态"：
        // avatar 有值 → custom；avatar 为 null → 恢复登录头像（回落 provider）。
        const providerAvatar = stored.providerAvatar || currentSession.user.providerAvatar || null
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
    } catch(error) { next(error) }
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
      const target = normalizeBindingTarget(req.body?.target, req.body?.type)
      if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
      assertContactAvailable(target, session.user.id)
      const blockedMessage = verificationSendBlocked(target, req)
      if (blockedMessage) return res.status(429).json({ message: blockedMessage })
      const debugCode = createVerificationCode(target, 'bind')
      if (target.type === 'email') {
        const transporter = getEmailTransporter()
        if (!transporter) {
          if (testVerificationDebugMode && localRequest(req) && !req.get('x-forwarded-for')) {
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
          if (testVerificationDebugMode && localRequest(req) && !req.get('x-forwarded-for')) {
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
        if (testVerificationDebugMode && localRequest(req) && !req.get('x-forwarded-for')) {
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
        discardVerificationCode(target, 'bind')
        const invalidNumber = /IncorrectPhoneNumber|InvalidPhoneNumber|incorrect.*number.*format|invalid.*phone.*number/i.test(`${error.code || ''} ${error.message || ''}`)
        throw httpError(invalidNumber ? 400 : 502, invalidNumber ? '手机号格式不正确，请检查 11 位中国大陆手机号' : '验证码短信发送失败，请稍后重试')
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
      const target = normalizeBindingTarget(req.body?.target, req.body?.type)
      if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
      // 检查到写入均为同步操作；并发请求也只能有一个账号占用该联系方式。
      assertContactAvailable(target, session.user.id)
      verifyAuthCode(target, req.body?.code, 'bind')
      // 同样以用户表为准：绑定手机/邮箱不应把 session 快照里可能过期的头像写回去。
      const stored = accountUserById(session.user.id) || session.user
      const user = upsertAccountUser({
        ...stored,
        [target.type]: target.value,
        contactBindingType: target.type,
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
    metadata.records[key] = pruneOrphanRecordEntries(normalizeAccountRecords(recordInputs(req.body?.records)))
    persistMetadata()
    res.json({ records: metadata.records[key] })
  })

  app.post('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const body = req.body || {}
    const incoming = Array.isArray(body.records) ? body.records : body.record ? [body.record] : []
    if (!incoming.length) return res.status(400).json({ message: '没有可同步的记录' })
    recordInputs(incoming)
    const key = accountRecordOwnerKey(session.user.id)
    metadata.records[key] = mergeAccountRecords(accountRecordsForUser(session.user.id), incoming)
    persistMetadata()
    res.status(201).json({ records: metadata.records[key] })
  })

  app.delete('/api/account/records', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const key = accountRecordOwnerKey(session.user.id)
    const body = objectInput(req.body, ['ids','all'], { nonempty:true })
    const clearAll = body.all === true && !Object.hasOwn(body,'ids')
    if (!clearAll && (Object.hasOwn(body,'all') || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200)) return res.status(400).json({ message: '请选择要删除的记录；全部清空需要明确确认' })
    const ids = clearAll ? [] : [...new Set(body.ids.map(id => textInput(id,'记录 ID',180)))]
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
    const current = accountNotificationSettingsForUser(session.user.id)
    metadata.notificationSettings[key] = booleanSettings(req.body?.settings, Object.keys(current), current)
    persistMetadata()
    res.json({ settings: metadata.notificationSettings[key] })
  })

}
