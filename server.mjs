import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import archiver from 'archiver'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '.env'))

const storageRoot = path.join(__dirname, 'storage')
const tempRoot = path.join(storageRoot, 'tmp')
const filesRoot = path.join(storageRoot, 'files')
const collectionsRoot = path.join(storageRoot, 'collections')
const distRoot = path.join(__dirname, 'dist')
const metadataPath = path.join(storageRoot, 'metadata.json')
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
const MAX_FILES = 100
const serverPort = Number(process.env.PORT || process.env.KUNQIONG_PORT || 8045)
const oauthAuthorizeUrl = process.env.KUNQIONG_OAUTH_AUTHORIZE_URL || 'https://login.kunqiongai.com/authorize.html'
const oauthTokenUrl = process.env.KUNQIONG_OAUTH_TOKEN_URL || 'https://login.kunqiongai.com/api/oauth/token'
const oauthClientId = process.env.KUNQIONG_OAUTH_CLIENT_ID || 'app_d1fbbfc18f7908d5'
const oauthClientSecret = process.env.KUNQIONG_OAUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || ''
const configuredCallbackUrls = splitConfigValues(process.env.KUNQIONG_AUTH_CALLBACK_URL)
const configuredAppUrl = process.env.KUNQIONG_APP_URL || ''
const AUTH_COOKIE_NAME = 'kunqiong_session'
const SHARE_ACCESS_COOKIE_PREFIX = 'kunqiong_share_access_'
const SHARE_ACCESS_TTL_SECONDS = 15 * 60
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const MAX_ACCOUNT_RECORDS = 200
const MAX_ACCOUNT_MESSAGES = 120
const MAX_RECORD_FILES = 120
const MAX_RECORD_SUBMISSIONS = 80
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000
const MAX_VERIFICATION_CODES = 120
const ACCOUNT_TOTAL_STORAGE_BYTES = 20 * 1024 * 1024 * 1024
const ACCOUNT_SINGLE_FILE_BYTES = MAX_FILE_SIZE
const ACCOUNT_RECORD_SCOPES = new Set(['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'])
const ACCOUNT_RECORD_KINDS = new Set(['share', 'collection'])
const ACCOUNT_MESSAGE_CATEGORIES = new Set(['system', 'official', 'other'])
const DEFAULT_NOTIFICATION_SETTINGS = {
  inApp: true,
  email: false,
  incomingShare: true,
  shareExpiring: true,
  shareDownloaded: true,
  collectionExpiring: true,
  collectionSubmitted: true,
}
const DEFAULT_ACCOUNT_MESSAGES = [
  { id: 'system-welcome', category: 'system', eventType: 'welcome', title: '欢迎使用鲲穹文件传输', body: '你的账户已连接，可以开始发送和收集文件。' },
  { id: 'official-update', category: 'official', eventType: 'official', title: '鲲穹服务通知', body: '站内消息、账号容量和账号绑定已接入当前账户。' },
]
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
let metadataNeedsPersist = false

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}

const metadata = normalizeMetadata(loadMetadata())
if (metadataNeedsPersist) persistMetadata()
const uploadSessions = new Map()
const oauthStates = new Map()
const upload = multer({
  dest: tempRoot,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
})
const app = express()

app.set('trust proxy', true)
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kunqiong-local-api', now: new Date().toISOString() })
})

app.get('/api/auth/login', (req, res) => {
  let returnTo = safeReturnUrl(req.query.return_to, req)
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
  res.redirect(loginUrl.toString())
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

  if (hasNickname) {
    const nickname = String(body.nickname || '').trim()
    if (!nickname) return res.status(400).json({ message: '昵称不能为空' })
    if (nickname.length > 40) return res.status(400).json({ message: '昵称最多 40 个字符' })
    session.user = { ...session.user, nickname }
  }
  if (hasAvatar) {
    const avatar = body.avatar === null ? null : String(body.avatar || '')
    if (avatar && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 600000)) {
      return res.status(400).json({ message: '头像格式不支持或图片过大，请上传 2 MB 以内的图片' })
    }
    session.user = {
      ...session.user,
      avatar: avatar || session.user.providerAvatar || null,
      avatarSource: avatar ? 'custom' : '',
    }
  }
  const user = upsertAccountUser(session.user)
  syncAccountUserSessions(user)
  persistMetadata()
  res.json({ user: publicAccountUser(user) })
})

app.post('/api/auth/code', (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const target = normalizeContactTarget(req.body?.target)
    if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
    const debugCode = createVerificationCode(target, 'bind')
    res.status(201).json({
      ok: true,
      channel: target.type === 'email' ? 'email' : 'sms',
      expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
      debugCode,
      message: target.type === 'email' ? '演示绑定验证码已生成，邮件通道接入后会自动发送。' : '演示绑定验证码已生成，短信通道接入后会自动发送。',
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
    if (existingUser && existingUser.id !== session.user.id) {
      return res.status(409).json({ message: target.type === 'email' ? '该邮箱已绑定其他账号' : '该手机号已绑定其他账号' })
    }
    const user = upsertAccountUser({
      ...session.user,
      [target.type]: target.value,
      loginMethods: mergeLoginMethods(session.user.loginMethods, [boundMethodForTargetType(target.type)]),
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
  metadata.records[key] = normalizeAccountRecords(req.body?.records)
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
  if (ids.length) {
    const targets = new Set(ids)
    metadata.records[key] = accountRecordsForUser(session.user.id).filter((record) => !targets.has(record.id))
  } else {
    metadata.records[key] = []
  }
  persistMetadata()
  res.json({ records: metadata.records[key] })
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

app.get('/auth/callback', async (req, res) => {
  const code = firstValue(req.query.code)
  const state = firstValue(req.query.state)
  const pendingState = consumeOAuthState(state)
  const returnTo = pendingState?.returnTo || safeReturnUrl('', req)

  if (!pendingState) return res.redirect(appendAuthResult(returnTo, 'failed', '登录状态已过期，请重新登录'))
  if (!code) return res.redirect(appendAuthResult(returnTo, 'failed', '授权码缺失，请重新登录'))

  try {
    const tokenData = await exchangeOAuthToken(code, pendingState.redirectUri)
    const session = createAuthSession(tokenData)
    setAuthCookie(res, session.id, session.expiresAt, req)
    res.redirect(appendAuthResult(returnTo, 'success'))
  } catch (error) {
    res.redirect(appendAuthResult(returnTo, 'failed', error.message || '登录失败'))
  }
})

app.post('/api/shares', upload.array('files', MAX_FILES), async (req, res, next) => {
  try {
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) return res.status(400).json({ message: '至少选择一个文件' })

    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      return {
        name: file.originalname,
        relativePath,
        size: file.size,
        mimeType: file.mimetype || 'application/octet-stream',
        tempPath: file.path,
      }
    })

    const share = await createShareFromTempFiles(files, readShareOptions(req.body), req)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
  }
})

app.post('/api/upload-sessions', (req, res) => {
  const files = Array.isArray(req.body.files) ? req.body.files : []
  if (!files.length) return res.status(400).json({ message: '至少选择一个文件' })
  if (files.length > MAX_FILES) return res.status(413).json({ message: `单次最多上传 ${MAX_FILES} 个文件` })

  const normalizedFiles = files.map((file, index) => ({
    name: String(file.name || `文件 ${index + 1}`),
    relativePath: safeRelativePath(file.relativePath || file.name || `文件 ${index + 1}`),
    size: Number(file.size || 0),
    mimeType: String(file.mimeType || 'application/octet-stream'),
    chunks: new Set(),
  }))
  const invalid = normalizedFiles.find((file) => file.size > MAX_FILE_SIZE)
  if (invalid) return res.status(413).json({ message: `${invalid.name} 超过 5 GB 限制` })

  const sessionId = createToken(18)
  const sessionDirectory = path.join(tempRoot, 'upload-sessions', sessionId)
  fs.mkdirSync(sessionDirectory, { recursive: true })
  const session = {
    id: sessionId,
    files: normalizedFiles,
    options: readShareOptions(req.body),
    directory: sessionDirectory,
    createdAt: new Date().toISOString(),
  }
  uploadSessions.set(sessionId, session)
  res.status(201).json({ sessionId, uploaded: session.files.map((file) => ({ name: file.name, chunks: [] })) })
})

app.post('/api/upload-sessions/:sessionId/chunks', upload.single('chunk'), (req, res, next) => {
  try {
    const session = uploadSessions.get(req.params.sessionId)
    if (!session) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
    }
    const fileIndex = Number(req.body.fileIndex)
    const chunkIndex = Number(req.body.chunkIndex)
    const totalChunks = Number(req.body.totalChunks)
    if (!Number.isInteger(fileIndex) || !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks)) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片参数不完整' })
    }
    const file = session.files[fileIndex]
    if (!file || !req.file) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片文件不存在' })
    }
    const chunksDirectory = path.join(session.directory, String(fileIndex))
    fs.mkdirSync(chunksDirectory, { recursive: true })
    fs.renameSync(req.file.path, path.join(chunksDirectory, `${chunkIndex}.part`))
    file.totalChunks = totalChunks
    file.chunks.add(chunkIndex)
    res.json({ ok: true, fileIndex, chunkIndex, uploadedChunks: file.chunks.size })
  } catch (error) {
    cleanupUploadedFiles(req.file ? [req.file] : [])
    next(error)
  }
})

app.post('/api/upload-sessions/:sessionId/complete', async (req, res, next) => {
  try {
    const session = uploadSessions.get(req.params.sessionId)
    if (!session) return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
    for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
      const file = session.files[fileIndex]
      const expectedChunks = Number(file.totalChunks || Math.max(1, Math.ceil(file.size / Number(req.body.chunkSize || 1))))
      if (file.chunks.size < expectedChunks) {
        return res.status(409).json({ message: `${file.name} 还有分片未上传完成` })
      }
    }

    const mergedFiles = session.files.map((file, fileIndex) => {
      const mergedPath = path.join(session.directory, `${fileIndex}-merged`)
      const output = fs.openSync(mergedPath, 'w')
      const chunksDirectory = path.join(session.directory, String(fileIndex))
      try {
        for (let chunkIndex = 0; chunkIndex < file.totalChunks; chunkIndex += 1) {
          const chunkPath = path.join(chunksDirectory, `${chunkIndex}.part`)
          if (!fs.existsSync(chunkPath)) throw new Error(`${file.name} 分片缺失，请重试上传`)
          fs.writeSync(output, fs.readFileSync(chunkPath))
        }
      } finally {
        fs.closeSync(output)
      }
      return {
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
        tempPath: mergedPath,
      }
    })
    const share = await createShareFromTempFiles(mergedFiles, session.options, req)
    uploadSessions.delete(session.id)
    removeDirectory(session.directory)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/lookup/:code', (req, res) => {
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShare(share, undefined, { allowMissingPassword: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  if (share.passwordHash) return res.json({ share: publicShare(share, req, false), requiresPassword: true })
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.post('/api/shares/lookup/:code', (req, res) => {
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShare(share, req.body.password)
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  setShareAccessCookie(res, req, share)
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  const access = validateShare(share, undefined, { allowMissingPassword: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  res.json({ share: publicShare(share, req, !share.passwordHash), requiresPassword: Boolean(share.passwordHash) })
})

app.get('/api/shares/manage/:manageToken', (req, res) => {
  const share = findShareByManageToken(req.params.manageToken)
  if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
  res.json({ share: publicShare(share, req, true, true) })
})

app.patch('/api/shares/manage/:manageToken', async (req, res, next) => {
  try {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    applyShareUpdate(share, req.body || {})
    share.updatedAt = new Date().toISOString()
    if (share.status === 'active' && !fs.existsSync(path.join(filesRoot, share.id))) {
      return res.status(410).json({ message: '分享文件已清理，无法恢复为有效状态' })
    }
    persistMetadata()
    res.json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/shares/manage/:manageToken', (req, res, next) => {
  try {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    share.status = 'closed'
    share.updatedAt = new Date().toISOString()
    removeDirectory(path.join(filesRoot, share.id))
    persistMetadata()
    res.json({ share: publicShare(share, req, false, true) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/download', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    const access = validateShare(share, req.get('x-share-password'))
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    registerShareDownload(share, res)
    const shareDirectory = path.join(filesRoot, share.id)
    if (share.files.length === 1) {
      const file = share.files[0]
      sendDownloadFile(res, next, path.join(shareDirectory, file.storedName), file)
      return
    }
    await streamZip(res, next, '鲲穹文件包.zip', share.files.map((file) => ({
      path: path.join(shareDirectory, file.storedName),
      name: file.relativePath,
      size: file.size,
    })))
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/files/:fileIndex/download', (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    const access = validateShare(share, req.get('x-share-password'))
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    registerShareDownload(share, res)
    sendDownloadFile(res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/files/:fileIndex/preview', (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    const access = validateShareRequest(share, req)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    sendPreviewFile(res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.post('/api/collections', async (req, res, next) => {
  try {
    const ownerSession = authSessionFromRequest(req)
    const title = String(req.body.title || '').trim()
    if (!title) return res.status(400).json({ message: '请填写任务名称' })
    const token = createToken(10)
    const manageToken = createToken(18)
    const deadline = normalizeExpiryInput(req.body.deadline || new Date(Date.now() + 7 * 86400000).toISOString(), '截止时间')
    if (!deadline) return res.status(400).json({ message: '截止时间格式不正确' })
    const task = {
      id: token,
      token,
      manageToken,
      title,
      description: String(req.body.description || '请上传你负责的文件'),
      deadline,
      allowedTypes: Array.isArray(req.body.allowedTypes) ? req.body.allowedTypes : [],
      maxFileSizeMb: Number(req.body.maxFileSizeMb || 500),
      createdAt: new Date().toISOString(),
      ownerUserId: ownerSession?.user?.id || '',
      status: 'active',
      submissions: [],
    }
    task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${token}`, { width: 180, margin: 1 })
    metadata.collections.push(task)
    persistMetadata()
    res.status(201).json({ collection: publicCollection(task, req, true), manageToken })
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/:token', (req, res) => {
  const task = metadata.collections.find((item) => item.token === req.params.token)
  if (!task) return res.status(404).json({ message: '收集任务不存在' })
  const access = validateCollection(task)
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  res.json({ collection: publicCollection(task, req) })
})

app.post('/api/collections/:token/submissions', upload.array('files', MAX_FILES), (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.token === req.params.token)
    if (!task) {
      cleanupUploadedFiles(req.files)
      return res.status(404).json({ message: '收集任务不存在' })
    }
    const access = validateCollection(task)
    if (!access.ok) {
      cleanupUploadedFiles(req.files)
      return res.status(access.status).json({ message: access.message })
    }
    const participantName = String(req.body.participantName || '').trim()
    if (!participantName) {
      cleanupUploadedFiles(req.files)
      return res.status(400).json({ message: '请填写提交人名称' })
    }
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) {
      return res.status(400).json({ message: '至少选择一个文件' })
    }
    const invalidFile = uploadedFiles.find((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname, task.allowedTypes))
    if (invalidFile) {
      cleanupUploadedFiles(uploadedFiles)
      return res.status(413).json({ message: `${invalidFile.originalname} 不符合当前收集任务的文件限制` })
    }
    const submissionId = createToken(12)
    const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
    fs.mkdirSync(submissionDirectory, { recursive: true })
    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
      fs.renameSync(file.path, path.join(submissionDirectory, storedName))
      return { name: file.originalname, relativePath, storedName, size: file.size, mimeType: file.mimetype || 'application/octet-stream' }
    })
    const submission = { id: submissionId, participantName, submittedAt: new Date().toISOString(), files }
    task.submissions.push(submission)
    addCollectionSubmissionMessage(task, submission, req)
    persistMetadata()
    res.status(201).json({ submission: publicSubmission(submission) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken', (req, res) => {
  const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
  if (!task) return res.status(404).json({ message: '管理链接不存在' })
  res.json({ collection: managerCollection(task, req) })
})

app.patch('/api/collections/manage/:manageToken', (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    applyCollectionUpdate(task, req.body || {})
    task.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ collection: managerCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/collections/manage/:manageToken', (req, res, next) => {
  try {
    const index = metadata.collections.findIndex((item) => item.manageToken === req.params.manageToken)
    if (index < 0) return res.status(404).json({ message: '管理链接不存在' })
    const [task] = metadata.collections.splice(index, 1)
    removeDirectory(path.join(collectionsRoot, task.id))
    persistMetadata()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/collections/manage/:manageToken/submissions/:submissionId', (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submissionIndex = task.submissions.findIndex((item) => item.id === req.params.submissionId)
    if (submissionIndex < 0) return res.status(404).json({ message: '提交记录不存在' })
    const [submission] = task.submissions.splice(submissionIndex, 1)
    removeDirectory(path.join(collectionsRoot, task.id, submission.id))
    task.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ collection: managerCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/download', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const entries = collectionZipEntries(task)
    if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
    await streamZip(res, next, `${task.title || '收集文件'}.zip`, entries)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/download', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    if (!submission) return res.status(404).json({ message: '提交记录不存在' })
    const entries = collectionZipEntries(task, submission)
    if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
    await streamZip(res, next, `${submission.participantName || '提交文件'}.zip`, entries)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/download', (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    sendDownloadFile(res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/preview', (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    sendPreviewFile(res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

if (fs.existsSync(distRoot)) {
  app.use(express.static(distRoot))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distRoot, 'index.html'))
  })
}

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error.status) return res.status(error.status).json({ message: error.message || '请求处理失败' })
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '文件超过 5 GB 限制' })
  if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ message: `单次最多上传 ${MAX_FILES} 个文件` })
  res.status(500).json({ message: '服务器处理失败，请稍后重试' })
})

const server = app.listen(serverPort, '0.0.0.0', () => {
  console.log(`鲲穹服务 listening on http://localhost:${serverPort}`)
})

const cleanupTimer = setInterval(cleanupExpired, 60 * 1000)
cleanupTimer.unref()
cleanupExpired()

function loadMetadata() {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch {
    return { shares: [], collections: [], sessions: [], records: {}, users: {}, messages: {}, notificationSettings: {}, verificationCodes: [] }
  }
}

function normalizeMetadata(value = {}) {
  const shares = Array.isArray(value.shares) ? value.shares : []
  for (const share of shares) {
    if (!share.manageToken) {
      share.manageToken = createToken(18)
      metadataNeedsPersist = true
    }
  }
  const collections = Array.isArray(value.collections) ? value.collections : []
  for (const task of collections) {
    if (!task.manageToken) {
      task.manageToken = createToken(18)
      metadataNeedsPersist = true
    }
    if (!Array.isArray(task.submissions)) {
      task.submissions = []
      metadataNeedsPersist = true
    }
  }
  const sessions = Array.isArray(value.sessions) ? value.sessions.filter((session) => session?.id && session?.user) : []
  const users = normalizeAccountUserStore(value.users, sessions)
  return {
    ...value,
    shares,
    collections,
    sessions,
    records: normalizeAccountRecordStore(value.records),
    users,
    messages: normalizeAccountMessageStore(value.messages),
    notificationSettings: normalizeNotificationSettingsStore(value.notificationSettings),
    verificationCodes: normalizeVerificationCodes(value.verificationCodes),
  }
}

function persistMetadata() {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
}

function cleanupExpired() {
  const now = Date.now()
  let changed = false
  for (const share of metadata.shares) {
    if (maybeNotifyExpiringShare(share, now)) changed = true
    if (share.status === 'active' && share.expiresAt && new Date(share.expiresAt).getTime() <= now) {
      share.status = 'expired'
      changed = true
      removeDirectory(path.join(filesRoot, share.id))
    }
  }
  for (const task of metadata.collections) {
    if (maybeNotifyExpiringCollection(task, now)) changed = true
    if (task.status === 'active' && new Date(task.deadline).getTime() <= now) {
      task.status = 'expired'
      changed = true
    }
    if (task.status === 'expired' && new Date(task.deadline).getTime() + 86400000 <= now) {
      removeDirectory(path.join(collectionsRoot, task.id))
      task.submissions = []
      task.cleanedAt = new Date().toISOString()
      changed = true
    }
  }
  const activeSessions = metadata.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  if (activeSessions.length !== metadata.sessions.length) {
    metadata.sessions = activeSessions
    changed = true
  }
  if (changed) persistMetadata()
}

function publicShare(share, req, includeFiles = true, includeManage = false) {
  const payload = {
    id: share.id,
    code: share.code,
    files: includeFiles ? share.files.map(({ storedName, ...file }) => file) : [],
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    downloadLimit: share.downloadLimit,
    downloadCount: share.downloadCount,
    remainingDownloads: share.downloadLimit ? Math.max(share.downloadLimit - share.downloadCount, 0) : null,
    shareUrl: `${getOrigin(req)}/share/${share.id}`,
    downloadUrl: `${getOrigin(req)}/api/shares/${share.id}/download`,
    qrDataUrl: share.qrDataUrl,
    requiresPassword: Boolean(share.passwordHash),
    deliveryRecipients: share.deliveryRecipients || [],
    notificationLog: share.notificationLog || [],
    status: share.status,
  }
  if (includeManage) {
    payload.manageToken = share.manageToken
    payload.manageUrl = `${getOrigin(req)}/share/manage/${share.manageToken}`
  }
  return payload
}

function publicCollection(task, req, includeManage = false) {
  const payload = {
    id: task.id,
    token: task.token,
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    allowedTypes: task.allowedTypes,
    maxFileSizeMb: task.maxFileSizeMb,
    status: task.status,
    submissionCount: task.submissions.length,
    publicUrl: `${getOrigin(req)}/collect/${task.token}`,
    qrDataUrl: task.qrDataUrl,
  }
  if (includeManage) {
    payload.manageToken = task.manageToken
    payload.manageUrl = `${getOrigin(req)}/collect/manage/${task.manageToken}`
  }
  return payload
}

function managerCollection(task, req) {
  return {
    ...publicCollection(task, req, true),
    submissions: task.submissions.map(publicSubmission),
    downloadUrl: `${getOrigin(req)}/api/collections/manage/${task.manageToken}/download`,
  }
}

function validateShareRequest(share, req, options = {}) {
  return validateShare(share, req.get('x-share-password'), {
    ...options,
    hasAccessCookie: hasShareAccessCookie(req, share),
  })
}

function setShareAccessCookie(res, req, share) {
  if (!share.passwordHash) return
  res.setHeader('Set-Cookie', serializeCookie(shareAccessCookieName(share), shareAccessCookieValue(share), {
    httpOnly: true,
    maxAge: SHARE_ACCESS_TTL_SECONDS,
    path: `/api/shares/${share.id}`,
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function hasShareAccessCookie(req, share) {
  if (!share.passwordHash) return false
  return readCookie(req, shareAccessCookieName(share)) === shareAccessCookieValue(share)
}

function shareAccessCookieName(share) {
  return `${SHARE_ACCESS_COOKIE_PREFIX}${share.id}`
}

function shareAccessCookieValue(share) {
  return hashSecret(`share-preview:${share.id}:${share.passwordHash}`)
}

function registerShareDownload(share, res) {
  let counted = false
  res.on('finish', () => {
    if (counted || res.statusCode < 200 || res.statusCode >= 300) return
    counted = true
    share.downloadCount += 1
    share.updatedAt = new Date().toISOString()
    addShareDownloadedMessage(share)
    persistMetadata()
  })
}

function sendPreviewFile(res, next, filePath, file) {
  const kind = previewKind(file)
  if (!kind) return res.status(415).json({ message: '当前文件类型暂不支持在线预览' })
  if (!fs.existsSync(filePath)) return res.status(410).json({ message: '文件已清理，无法预览' })
  const stat = fs.statSync(filePath)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Disposition', contentDisposition('inline', file.name || path.basename(filePath)))
  res.setHeader('X-Preview-Type', kind)
  res.setHeader('X-Preview-File-Size', String(stat.size))
  res.type(fileContentType(file))
  res.sendFile(filePath, (error) => {
    if (!error) return
    if (!res.headersSent) next(error)
    else console.error(error)
  })
}

function sendDownloadFile(res, next, filePath, file) {
  if (!fs.existsSync(filePath)) return res.status(410).json({ message: '文件已清理，无法下载' })
  const stat = fs.statSync(filePath)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-Download-File-Count', '1')
  res.setHeader('X-Download-Resume', 'range')
  res.setHeader('X-Download-Total-Size', String(stat.size))
  if (file.mimeType) res.type(file.mimeType)
  res.download(filePath, file.name || path.basename(filePath), (error) => {
    if (!error) return
    if (!res.headersSent) next(error)
    else console.error(error)
  })
}

async function streamZip(res, next, filename, entries) {
  const availableEntries = entries.filter((entry) => fs.existsSync(entry.path))
  if (!availableEntries.length) return res.status(410).json({ message: '文件已清理，无法下载' })
  const totalSize = availableEntries.reduce((sum, entry) => sum + Number(entry.size || 0), 0)
  res.setHeader('X-Download-File-Count', String(availableEntries.length))
  res.setHeader('X-Download-Resume', 'unsupported-for-archive')
  res.setHeader('X-Download-Total-Size', String(totalSize))
  res.setHeader('Accept-Ranges', 'none')
  res.attachment(filename)
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', (error) => {
    if (error.code === 'ENOENT') console.warn(error)
    else next(error)
  })
  archive.on('error', next)
  archive.pipe(res)
  for (const entry of availableEntries) {
    archive.file(entry.path, { name: zipEntryPath(entry.name) })
  }
  await archive.finalize()
}

function collectionZipEntries(task, targetSubmission = null) {
  const submissions = targetSubmission ? [targetSubmission] : task.submissions
  return submissions.flatMap((submission) => {
    const folder = targetSubmission ? '' : `${submission.participantName || '提交文件'}-${submission.id.slice(0, 6)}`
    return submission.files.map((file) => ({
      path: path.join(collectionsRoot, task.id, submission.id, file.storedName),
      name: zipEntryPath(folder, file.relativePath),
      size: file.size,
    }))
  })
}

function zipEntryPath(...parts) {
  return parts
    .filter((part) => String(part || '').trim())
    .flatMap((part) => safeRelativePath(part).split('/'))
    .filter(Boolean)
    .join('/') || '未命名文件'
}

function previewKind(file = {}) {
  const contentType = fileContentType(file)
  const extension = path.extname(file.name || file.relativePath || '').toLowerCase()
  if (contentType === 'application/pdf' || extension === '.pdf') return 'pdf'
  if (contentType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return 'image'
  if (contentType.startsWith('video/') || ['.mp4', '.webm', '.ogv', '.mov', '.m4v'].includes(extension)) return 'video'
  if (contentType.startsWith('audio/') || ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.ogg'].includes(extension)) return 'audio'
  return ''
}

function fileContentType(file = {}) {
  const mimeType = String(file.mimeType || '').trim().toLowerCase()
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType
  const extension = path.extname(file.name || file.relativePath || '').toLowerCase()
  const mimeTypes = {
    '.aac': 'audio/aac',
    '.bmp': 'image/bmp',
    '.flac': 'audio/flac',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.ogv': 'video/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
  }
  return mimeTypes[extension] || 'application/octet-stream'
}

function contentDisposition(type, filename) {
  const fallback = String(filename || 'preview')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '')
    .trim() || 'preview'
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(String(filename || fallback))}`
}

function publicUser(user = {}) {
  const avatarSource = String(user.avatarSource || '')
  const providerAvatar = user.providerAvatar || (!avatarSource ? user.avatar : null) || null
  const provider = String(user.provider || user.login_provider || user.oauth_provider || user.channel || user.source || '').trim()
  const email = normalizeEmailValue(user.email || user.mail)
  const phone = normalizePhoneValue(user.phone || user.mobile)
  const username = trimRecordString(user.username || user.name || user.login || email || phone, 80)
  return {
    id: trimRecordString(user.id || user.userId || user.user_id || user.openid || user.open_id || user.unionid || user.sub || email || phone, 120),
    username,
    nickname: trimRecordString(user.nickname || user.displayName || user.display_name || username || '鲲穹用户', 80),
    email,
    phone,
    avatar: user.avatar || null,
    avatarSource,
    providerAvatar,
    provider,
    loginMethods: mergeLoginMethods(user.loginMethods, provider ? ['oauth'] : []),
    createdAt: normalizeRecordDate(user.createdAt),
    updatedAt: normalizeRecordDate(user.updatedAt),
  }
}

function publicAccountUser(user = {}) {
  const stored = accountUserById(user.id) || normalizeAccountUser(user) || publicUser(user)
  return {
    ...publicUser(stored),
    capacity: accountUsageForUser(stored.id),
    benefits: accountBenefitsForUser(stored),
    notificationSettings: accountNotificationSettingsForUser(stored.id),
  }
}

function normalizeAccountUserStore(value = {}, sessions = []) {
  const store = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const user of Object.values(value)) {
      const normalized = normalizeAccountUser(user)
      if (normalized?.id) store[normalized.id] = mergeAccountUser(store[normalized.id], normalized)
    }
  }
  for (const session of sessions) {
    const normalized = normalizeAccountUser(session.user)
    if (!normalized?.id) continue
    store[normalized.id] = mergeAccountUser(store[normalized.id], normalized)
    session.user = publicUser(store[normalized.id])
  }
  return store
}

function normalizeAccountUser(user = {}) {
  const base = publicUser(user)
  const contactTarget = base.email
    ? { type: 'email', value: base.email }
    : base.phone
      ? { type: 'phone', value: base.phone }
      : null
  const id = base.id || (contactTarget ? accountUserIdForTarget(contactTarget) : '')
  if (!id) return null
  const now = new Date().toISOString()
  return {
    ...base,
    id,
    loginMethods: mergeLoginMethods(base.loginMethods, user.loginMethods),
    createdAt: normalizeRecordDate(user.createdAt) || now,
    updatedAt: normalizeRecordDate(user.updatedAt) || now,
  }
}

function mergeAccountUser(existing = null, incoming = {}) {
  if (!existing) return normalizeAccountUser(incoming)
  const normalized = normalizeAccountUser(incoming)
  if (!normalized) return existing
  return {
    ...existing,
    ...normalized,
    nickname: normalized.nickname || existing.nickname,
    email: normalized.email || existing.email,
    phone: normalized.phone || existing.phone,
    avatar: normalized.avatar || existing.avatar,
    avatarSource: normalized.avatarSource || existing.avatarSource,
    providerAvatar: normalized.providerAvatar || existing.providerAvatar,
    provider: normalized.provider || existing.provider,
    loginMethods: mergeLoginMethods(existing.loginMethods, normalized.loginMethods),
    createdAt: existing.createdAt || normalized.createdAt,
    updatedAt: new Date().toISOString(),
  }
}

function upsertAccountUser(user = {}) {
  const normalized = normalizeAccountUser(user)
  if (!normalized?.id) return publicUser(user)
  if (!metadata.users || typeof metadata.users !== 'object' || Array.isArray(metadata.users)) metadata.users = {}
  metadata.users[normalized.id] = mergeAccountUser(metadata.users[normalized.id], normalized)
  return metadata.users[normalized.id]
}

function accountUserById(userId) {
  const key = accountRecordOwnerKey(userId)
  return key && metadata.users && typeof metadata.users === 'object' ? metadata.users[key] || null : null
}

function syncAccountUserSessions(user = {}) {
  if (!user.id) return
  const sessionUser = publicUser(user)
  for (const session of metadata.sessions) {
    if (session.user?.id === user.id) session.user = sessionUser
  }
}

function normalizeEmailValue(value) {
  const email = trimRecordString(value, 160).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function normalizePhoneValue(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  return digits.length >= 6 && digits.length <= 20 ? digits : ''
}

function normalizeContactTarget(value) {
  const raw = trimRecordString(value, 160)
  if (!raw) return null
  const email = normalizeEmailValue(raw)
  if (email) return { type: 'email', value: email, label: email }
  const phone = normalizePhoneValue(raw)
  if (phone) return { type: 'phone', value: phone, label: phone }
  return null
}

function accountUserIdForTarget(target) {
  return `contact_${target.type}_${hashSecret(target.value).slice(0, 18)}`
}

function findAccountUserByTarget(target) {
  if (!target) return null
  const users = Object.values(metadata.users || {})
  return users.find((user) => target.type === 'email' ? normalizeEmailValue(user.email) === target.value : normalizePhoneValue(user.phone) === target.value) || null
}

function boundMethodForTargetType(type) {
  return type === 'email' ? 'email_bound' : 'phone_bound'
}

function mergeLoginMethods(...groups) {
  return Array.from(new Set(groups.flatMap((group) => Array.isArray(group) ? group : group ? [group] : []).map((item) => trimRecordString(item, 40)).filter(Boolean)))
}

function normalizeVerificationScene() {
  return 'bind'
}

function normalizeVerificationCodes(value = []) {
  if (!Array.isArray(value)) return []
  const now = Date.now()
  return value.map((item) => ({
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: item?.type === 'phone' ? 'phone' : 'email',
    target: trimRecordString(item?.target, 160),
    scene: normalizeVerificationScene(item?.scene),
    codeHash: trimRecordString(item?.codeHash, 80),
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
    expiresAt: normalizeRecordDate(item?.expiresAt),
  })).filter((item) => item.target && item.codeHash && item.expiresAt && new Date(item.expiresAt).getTime() > now).slice(0, MAX_VERIFICATION_CODES)
}

function cleanupVerificationCodes() {
  const next = normalizeVerificationCodes(metadata.verificationCodes)
  if (next.length !== (metadata.verificationCodes || []).length) {
    metadata.verificationCodes = next
    persistMetadata()
  }
}

function createVerificationCode(target, scene) {
  cleanupVerificationCodes()
  const code = String(crypto.randomInt(100000, 1000000))
  const now = new Date()
  metadata.verificationCodes = normalizeVerificationCodes(metadata.verificationCodes)
    .filter((item) => !(item.type === target.type && item.target === target.value && item.scene === scene))
  metadata.verificationCodes.unshift({
    id: createToken(10),
    type: target.type,
    target: target.value,
    scene,
    codeHash: hashSecret(code),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS).toISOString(),
  })
  metadata.verificationCodes = metadata.verificationCodes.slice(0, MAX_VERIFICATION_CODES)
  persistMetadata()
  return code
}

function verifyAuthCode(target, value, scene) {
  cleanupVerificationCodes()
  const codeHash = hashSecret(trimRecordString(value, 12))
  const index = metadata.verificationCodes.findIndex((item) => item.type === target.type && item.target === target.value && item.scene === scene && item.codeHash === codeHash)
  if (index < 0) throw httpError(400, '验证码不正确或已过期')
  metadata.verificationCodes.splice(index, 1)
  persistMetadata()
}

function accountUsageForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  const ownedShares = metadata.shares.filter((share) => share.ownerUserId === key && share.status === 'active')
  const ownedCollections = metadata.collections.filter((task) => task.ownerUserId === key && !task.cleanedAt)
  const shareBytes = ownedShares.reduce((sum, share) => sum + fileListSize(share.files), 0)
  const collectionBytes = ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + fileListSize(submission.files), 0), 0)
  const usedBytes = shareBytes + collectionBytes
  const fileCount = ownedShares.reduce((sum, share) => sum + (share.files?.length || 0), 0)
    + ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + (submission.files?.length || 0), 0), 0)
  return {
    usedBytes,
    totalBytes: ACCOUNT_TOTAL_STORAGE_BYTES,
    remainingBytes: Math.max(ACCOUNT_TOTAL_STORAGE_BYTES - usedBytes, 0),
    usageRatio: ACCOUNT_TOTAL_STORAGE_BYTES ? Math.min(1, usedBytes / ACCOUNT_TOTAL_STORAGE_BYTES) : 0,
    shareBytes,
    collectionBytes,
    shareCount: ownedShares.length,
    collectionCount: ownedCollections.length,
    fileCount,
    singleFileLimitBytes: ACCOUNT_SINGLE_FILE_BYTES,
  }
}

function accountBenefitsForUser() {
  return [
    { label: '鲲穹登录', detail: '继续使用官方统一登录完成账号认证', enabled: true },
    { label: '跨设备记录', detail: '收发记录和文件中心跟随账号同步', enabled: true },
    { label: '站内消息', detail: '分享、下载和收集动态进入消息中心', enabled: true },
    { label: '账号绑定', detail: '可绑定邮箱或手机号用于消息匹配', enabled: true },
    { label: '账号容量', detail: '当前基础权益 20 GB 临时空间', enabled: true },
    { label: '永久保存', detail: '会员权益，当前版本暂未开放', enabled: false },
  ]
}

function fileListSize(files = []) {
  return Array.isArray(files) ? files.reduce((sum, file) => sum + Number(file?.size || 0), 0) : 0
}

function normalizeNotificationSettingsStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, settings] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeNotificationSettings(settings)
  }
  return store
}

function normalizeNotificationSettings(settings = {}) {
  const next = { ...DEFAULT_NOTIFICATION_SETTINGS }
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = Boolean(settings[key])
    }
  }
  return next
}

function accountNotificationSettingsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return normalizeNotificationSettings()
  if (!metadata.notificationSettings || typeof metadata.notificationSettings !== 'object' || Array.isArray(metadata.notificationSettings)) metadata.notificationSettings = {}
  if (!metadata.notificationSettings[key]) metadata.notificationSettings[key] = normalizeNotificationSettings()
  return metadata.notificationSettings[key]
}

function normalizeAccountMessageStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, messages] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountMessages(messages)
  }
  return store
}

function normalizeAccountMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  const deduped = new Map()
  messages.map(normalizeAccountMessage).filter(Boolean).forEach((message) => {
    deduped.set(message.id, { ...deduped.get(message.id), ...message })
  })
  return Array.from(deduped.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, MAX_ACCOUNT_MESSAGES)
}

function normalizeAccountMessage(message = {}) {
  if (!message || typeof message !== 'object') return null
  const title = trimRecordString(message.title, 80)
  const body = trimRecordString(message.body, 280)
  if (!title && !body) return null
  const createdAt = normalizeRecordDate(message.createdAt) || new Date().toISOString()
  const category = ACCOUNT_MESSAGE_CATEGORIES.has(message.category) ? message.category : 'system'
  return {
    id: trimRecordString(message.id, 120) || createToken(12),
    category,
    eventType: trimRecordString(message.eventType, 40),
    title: title || '鲲穹消息',
    body,
    createdAt,
    unread: message.unread !== false,
    readAt: normalizeRecordDate(message.readAt),
    actionUrl: trimRecordString(message.actionUrl, 400),
  }
}

function accountMessagesForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.messages || typeof metadata.messages !== 'object' || Array.isArray(metadata.messages)) metadata.messages = {}
  const current = normalizeAccountMessages(metadata.messages[key])
  const currentIds = new Set(current.map((message) => message.id))
  const defaults = DEFAULT_ACCOUNT_MESSAGES
    .filter((message) => !currentIds.has(message.id))
    .map((message, index) => normalizeAccountMessage({ ...message, createdAt: new Date(Date.now() - (index + 1) * 1000).toISOString() }))
  metadata.messages[key] = normalizeAccountMessages([...defaults, ...current])
  return metadata.messages[key]
}

function addAccountMessage(userId, message = {}, { respectSettings = true } = {}) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return null
  if (respectSettings && !shouldDeliverAccountMessage(key, message.eventType)) return null
  const normalized = normalizeAccountMessage({ ...message, id: message.id || createToken(12), createdAt: message.createdAt || new Date().toISOString(), unread: true })
  if (!normalized) return null
  metadata.messages[key] = normalizeAccountMessages([normalized, ...accountMessagesForUser(key)])
  return normalized
}

function shouldDeliverAccountMessage(userId, eventType) {
  const settings = accountNotificationSettingsForUser(userId)
  if (!settings.inApp) return false
  return !eventType || !Object.prototype.hasOwnProperty.call(settings, eventType) || settings[eventType] !== false
}

function findUsersByRecipient(recipient) {
  const raw = trimRecordString(recipient, 160).toLowerCase()
  if (!raw) return []
  const target = normalizeContactTarget(raw)
  return Object.values(metadata.users || {}).filter((user) => {
    if (target?.type === 'email' && normalizeEmailValue(user.email) === target.value) return true
    if (target?.type === 'phone' && normalizePhoneValue(user.phone) === target.value) return true
    return [user.id, user.username, user.nickname].some((value) => trimRecordString(value, 160).toLowerCase() === raw)
  })
}

function notifyShareRecipients(share, req, ownerUser = null) {
  const recipients = Array.isArray(share.deliveryRecipients) ? share.deliveryRecipients : []
  const ownerName = displayAccountName(ownerUser)
  const title = share.files?.[0]?.name || '文件分享'
  return recipients.map((recipient) => {
    const matchedUsers = findUsersByRecipient(recipient)
    const deliveredUserIds = []
    for (const user of matchedUsers) {
      const delivered = addAccountMessage(user.id, {
        category: 'other',
        eventType: 'incomingShare',
        title: '你收到一个文件分享',
        body: `${ownerName} 给你发送了 ${share.files.length} 个文件，取件码 ${share.code}。`,
        actionUrl: `/share/${share.id}`,
      })
      if (delivered) deliveredUserIds.push(user.id)
    }
    const target = normalizeContactTarget(recipient)
    const pendingStatus = target?.type === 'phone' ? '短信通道未配置' : target?.type === 'email' ? '邮件通道未配置' : '未匹配账号'
    return {
      recipient,
      status: deliveredUserIds.length ? '站内已发送' : matchedUsers.length ? '站内通知已关闭' : pendingStatus,
      channel: deliveredUserIds.length ? 'in-app' : target?.type || 'unknown',
      sentAt: new Date().toISOString(),
      deliveredUserIds,
      title,
      shareUrl: `${getOrigin(req)}/share/${share.id}`,
    }
  })
}

function addShareDownloadedMessage(share) {
  if (!share.ownerUserId) return null
  return addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareDownloaded',
    title: '你发送的文件已被下载',
    body: `${share.files?.[0]?.name || '文件分享'} 已产生第 ${share.downloadCount} 次下载。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
}

function addCollectionSubmissionMessage(task, submission, req) {
  if (!task.ownerUserId) return null
  return addAccountMessage(task.ownerUserId, {
    category: 'other',
    eventType: 'collectionSubmitted',
    title: '收集任务收到新提交',
    body: `${submission.participantName || '提交者'} 向「${task.title}」提交了 ${submission.files.length} 个文件。`,
    actionUrl: `${getOrigin(req)}/collect/manage/${task.manageToken}`,
  })
}

function maybeNotifyExpiringShare(share, now) {
  if (!share.ownerUserId || share.status !== 'active' || !share.expiresAt) return false
  if (share.notificationFlags?.shareExpiring) return false
  const expiresAt = new Date(share.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 3 * 86400000) return false
  const message = addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareExpiring',
    title: '文件分享即将过期',
    body: `${share.files?.[0]?.name || '文件分享'} 将在 ${new Date(share.expiresAt).toLocaleString('zh-CN')} 过期。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
  if (!message) return false
  share.notificationFlags = { ...(share.notificationFlags || {}), shareExpiring: true }
  return true
}

function maybeNotifyExpiringCollection(task, now) {
  if (!task.ownerUserId || task.status !== 'active' || !task.deadline) return false
  if (task.notificationFlags?.collectionExpiring) return false
  const deadline = new Date(task.deadline).getTime()
  if (!Number.isFinite(deadline) || deadline <= now || deadline - now > 3 * 86400000) return false
  const message = addAccountMessage(task.ownerUserId, {
    category: 'system',
    eventType: 'collectionExpiring',
    title: '收集任务即将截止',
    body: `「${task.title}」将在 ${new Date(task.deadline).toLocaleString('zh-CN')} 截止。`,
    actionUrl: `/collect/manage/${task.manageToken}`,
  })
  if (!message) return false
  task.notificationFlags = { ...(task.notificationFlags || {}), collectionExpiring: true }
  return true
}

function displayAccountName(user = {}) {
  return trimRecordString(user?.nickname || user?.username || user?.email || user?.phone, 80) || '对方'
}

function requireAuthSession(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) res.status(401).json({ message: '请先登录' })
  return session
}

function accountRecordOwnerKey(userId) {
  return trimRecordString(userId, 120)
}

function accountRecordsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.records || typeof metadata.records !== 'object' || Array.isArray(metadata.records)) metadata.records = {}
  if (!Array.isArray(metadata.records[key])) metadata.records[key] = []
  return metadata.records[key]
}

function normalizeAccountRecordStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, records] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountRecords(records)
  }
  return store
}

function mergeAccountRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeAccountRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  normalizeAccountRecords(incomingRecords).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  return Array.from(merged.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS)
}

function normalizeAccountRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeAccountRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS)
}

function normalizeAccountRecord(record = {}) {
  if (!record || typeof record !== 'object') return null
  const id = trimRecordString(record.id, 180)
  if (!id) return null
  const scope = ACCOUNT_RECORD_SCOPES.has(record.scope) ? record.scope : legacyScopeFromType(record.type)
  const kind = ACCOUNT_RECORD_KINDS.has(record.kind)
    ? record.kind
    : scope === 'my_collections' || scope === 'collect_from_me'
      ? 'collection'
      : 'share'
  const now = new Date().toISOString()
  const createdAt = normalizeRecordDate(record.createdAt || record.submittedAt) || now
  const updatedAt = normalizeRecordDate(record.updatedAt || record.lastSeenAt) || createdAt
  return {
    id,
    scope,
    kind,
    type: trimRecordString(record.type, 20) || (kind === 'collection' ? '收集' : '发送'),
    name: trimRecordString(record.name, 160) || (kind === 'collection' ? '收集任务' : '文件分享'),
    alias: trimRecordString(record.alias, 160),
    meta: trimRecordString(record.meta, 240),
    code: trimRecordString(record.code, 40),
    status: trimRecordString(record.status, 40),
    shareId: trimRecordString(record.shareId, 80),
    shareUrl: trimRecordString(record.shareUrl, 400),
    manageToken: trimRecordString(record.manageToken, 120),
    manageUrl: trimRecordString(record.manageUrl, 400),
    collectionToken: trimRecordString(record.collectionToken, 120),
    publicUrl: trimRecordString(record.publicUrl, 400),
    expiresAt: normalizeRecordDate(record.expiresAt),
    deadline: normalizeRecordDate(record.deadline),
    downloadLimit: normalizeNullablePositiveInteger(record.downloadLimit),
    downloadCount: normalizeNonNegativeInteger(record.downloadCount),
    fileCount: normalizeNonNegativeInteger(record.fileCount),
    totalSize: normalizeNonNegativeInteger(record.totalSize),
    submissionCount: normalizeNonNegativeInteger(record.submissionCount),
    participantName: trimRecordString(record.participantName, 80),
    submittedAt: normalizeRecordDate(record.submittedAt),
    allowedTypes: normalizeRecordStringArray(record.allowedTypes, 12, 20),
    maxFileSizeMb: normalizeNullablePositiveInteger(record.maxFileSizeMb),
    files: normalizeRecordFiles(record.files),
    submissions: normalizeRecordSubmissions(record.submissions),
    createdAt,
    updatedAt,
  }
}

function mergeAccountRecord(existing, incoming) {
  const merged = { ...existing, ...incoming }
  merged.createdAt = existing.createdAt || incoming.createdAt
  merged.updatedAt = incoming.updatedAt || existing.updatedAt || merged.createdAt
  if (!incoming.alias && existing.alias) merged.alias = existing.alias
  if ((!incoming.name || incoming.name === '文件分享' || incoming.name === '收集任务') && existing.name) merged.name = existing.name
  if (!incoming.meta && existing.meta) merged.meta = existing.meta
  if (!incoming.fileCount && existing.fileCount) merged.fileCount = existing.fileCount
  if (!incoming.totalSize && existing.totalSize) merged.totalSize = existing.totalSize
  if (!incoming.submissionCount && existing.submissionCount) merged.submissionCount = existing.submissionCount
  if ((!incoming.files || !incoming.files.length) && existing.files?.length) merged.files = existing.files
  if ((!incoming.submissions || !incoming.submissions.length) && existing.submissions?.length) merged.submissions = existing.submissions
  return merged
}

function normalizeRecordFiles(files) {
  if (!Array.isArray(files)) return []
  return files.slice(0, MAX_RECORD_FILES).map((file, index) => ({
    name: trimRecordString(file?.name, 180) || `文件 ${index + 1}`,
    relativePath: trimRecordString(file?.relativePath || file?.name, 260),
    size: normalizeNonNegativeInteger(file?.size),
    mimeType: trimRecordString(file?.mimeType, 100),
  }))
}

function normalizeRecordSubmissions(submissions) {
  if (!Array.isArray(submissions)) return []
  return submissions.slice(0, MAX_RECORD_SUBMISSIONS).map((submission) => ({
    id: trimRecordString(submission?.id, 120),
    participantName: trimRecordString(submission?.participantName, 80),
    submittedAt: normalizeRecordDate(submission?.submittedAt),
    files: normalizeRecordFiles(submission?.files),
  })).filter((submission) => submission.id || submission.files.length)
}

function normalizeRecordStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => trimRecordString(item, maxLength)).filter(Boolean))).slice(0, limit)
}

function normalizeRecordDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '' || value === 'unlimited') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function trimRecordString(value, maxLength) {
  const text = String(value ?? '').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function legacyScopeFromType(type) {
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

function compareAccountRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

function isOAuthConfigured() {
  return Boolean(oauthClientId && oauthClientSecret)
}

function authRedirectUri(req) {
  const origin = getRequestOrigin(req)
  if (configuredCallbackUrls.length) {
    try {
      const requestHost = new URL(origin).hostname
      const exactMatch = configuredCallbackUrls.find((item) => new URL(item).hostname === requestHost)
      if (exactMatch) return exactMatch
      if (['localhost', '127.0.0.1', '::1'].includes(requestHost)) {
        const localMatch = configuredCallbackUrls.find((item) => ['localhost', '127.0.0.1', '::1'].includes(new URL(item).hostname))
        if (localMatch) return localMatch
      }
    } catch {}
    return configuredCallbackUrls[0]
  }
  try {
    const url = new URL(origin)
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      return `http://localhost:${serverPort}/auth/callback`
    }
    return `${url.origin}/auth/callback`
  } catch {
    return `http://localhost:${serverPort}/auth/callback`
  }
}

async function exchangeOAuthToken(code, redirectUri) {
  const response = await fetch(oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: redirectUri,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (payload.code && payload.code !== 200)) {
    throw new Error(payload.message || `登录服务返回 ${response.status}`)
  }
  const data = payload.data || payload
  if (!data.access_token || !data.user) throw new Error('登录服务返回数据不完整')
  return data
}

function createAuthSession(tokenData) {
  cleanupExpiredAuthSessions()
  const now = new Date()
  const expiresIn = Math.max(60, Number(tokenData.expires_in || 3600))
  const user = upsertAccountUser({
    ...(tokenData.user || {}),
    loginMethods: mergeLoginMethods(tokenData.user?.loginMethods, ['oauth']),
  })
  const session = {
    id: createToken(40),
    accessToken: tokenData.access_token,
    tokenType: tokenData.token_type || 'Bearer',
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    createdAt: now.toISOString(),
    user: publicUser(user),
  }
  metadata.sessions.push(session)
  persistMetadata()
  return session
}

function authSessionFromRequest(req) {
  const sessionId = readCookie(req, AUTH_COOKIE_NAME)
  if (!sessionId) return null
  const session = metadata.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    removeAuthSession(sessionId)
    return null
  }
  const storedUser = accountUserById(session.user?.id)
  if (storedUser) session.user = publicUser(storedUser)
  return session
}

function removeAuthSession(sessionId) {
  const before = metadata.sessions.length
  metadata.sessions = metadata.sessions.filter((session) => session.id !== sessionId)
  if (metadata.sessions.length !== before) persistMetadata()
}

function cleanupExpiredAuthSessions() {
  const now = Date.now()
  const nextSessions = metadata.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  if (nextSessions.length !== metadata.sessions.length) {
    metadata.sessions = nextSessions
    persistMetadata()
  }
}

function cleanupOAuthStates() {
  const now = Date.now()
  for (const [state, value] of oauthStates.entries()) {
    if (now - value.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state)
  }
}

function consumeOAuthState(state) {
  cleanupOAuthStates()
  if (!state || !oauthStates.has(state)) return null
  const value = oauthStates.get(state)
  oauthStates.delete(state)
  return value
}

function safeReturnUrl(value, req) {
  const fallback = configuredAppUrl || getRequestOrigin(req)
  const allowedOrigins = new Set([
    fallback,
    getRequestOrigin(req),
    `http://localhost:${serverPort}`,
    'http://localhost:4173',
    `http://127.0.0.1:${serverPort}`,
    'http://127.0.0.1:4173',
    'http://43.154.197.96:8045',
  ].filter(Boolean).map((item) => {
    try { return new URL(item).origin } catch { return '' }
  }).filter(Boolean))
  try {
    const candidate = new URL(firstValue(value) || fallback, fallback)
    return allowedOrigins.has(candidate.origin) ? candidate.toString() : fallback
  } catch {
    return fallback
  }
}

function alignReturnUrlWithAuthHost(returnTo, redirectUri) {
  try {
    const target = new URL(returnTo)
    const callback = new URL(redirectUri)
    if (isLoopbackHost(target.hostname) && isLoopbackHost(callback.hostname) && target.hostname !== callback.hostname) {
      target.hostname = callback.hostname
      return target.toString()
    }
  } catch {}
  return returnTo
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase().replace(/^\[|\]$/g, ''))
}

function appendAuthResult(value, status, message = '') {
  const url = new URL(value)
  url.searchParams.set('login', status)
  if (message) url.searchParams.set('message', message)
  else url.searchParams.delete('message')
  return url.toString()
}

function setAuthCookie(res, sessionId, expiresAt, req) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function clearAuthCookie(res, req) {
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  return parts.join('; ')
}

function readCookie(req, name) {
  const cookies = String(req.get('cookie') || '').split(';')
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(valueParts.join('=') || '')
  }
  return ''
}

function isSecureRequest(req) {
  return req.secure || firstHeader(req.get('x-forwarded-proto')) === 'https'
}

function publicSubmission(submission) {
  return {
    id: submission.id,
    participantName: submission.participantName,
    submittedAt: submission.submittedAt,
    files: submission.files.map(({ storedName, ...file }) => file),
  }
}

async function createShareFromTempFiles(tempFiles, options, req) {
  const ownerSession = authSessionFromRequest(req)
  const shareToken = createToken(10)
  const shareDirectory = path.join(filesRoot, shareToken)
  fs.mkdirSync(shareDirectory, { recursive: true })
  const files = tempFiles.map((file, index) => {
    const relativePath = safeRelativePath(file.relativePath || file.name)
    const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
    fs.renameSync(file.tempPath, path.join(shareDirectory, storedName))
    return {
      name: file.name,
      relativePath,
      storedName,
      size: Number(file.size || 0),
      mimeType: file.mimeType || 'application/octet-stream',
    }
  })
  const expiryDays = String(options.expiryDays || '3')
  const downloadLimit = normalizeDownloadLimit(options.downloadLimit)
  const share = {
    id: shareToken,
    manageToken: createToken(18),
    code: createCode(options.codeLength),
    files,
    createdAt: new Date().toISOString(),
    expiresAt: expiryDays === '0' ? null : new Date(Date.now() + Number(expiryDays) * 86400000).toISOString(),
    downloadLimit,
    downloadCount: 0,
    passwordHash: options.password ? hashSecret(options.password) : null,
    deliveryRecipients: options.recipients,
    notificationLog: [],
    ownerUserId: ownerSession?.user?.id || '',
    status: 'active',
  }
  const shareUrl = `${getOrigin(req)}/share/${shareToken}`
  share.qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 180, margin: 1 })
  share.notificationLog = notifyShareRecipients(share, req, ownerSession?.user)
  metadata.shares.push(share)
  persistMetadata()
  return share
}

function readShareOptions(body = {}) {
  return {
    expiryDays: String(body.expiryDays || '3'),
    downloadLimit: String(body.downloadLimit || 'unlimited'),
    password: String(body.password || ''),
    codeLength: Number(body.codeLength || 4),
    recipients: parseRecipients(body.recipients),
  }
}

function normalizeDownloadLimit(value) {
  if (!value || value === 'unlimited') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function findShareByManageToken(manageToken) {
  return metadata.shares.find((share) => share.manageToken === String(manageToken || ''))
}

function applyShareUpdate(share, body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    share.expiresAt = normalizeExpiryInput(body.expiresAt, '分享有效期')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'downloadLimit')) {
    share.downloadLimit = normalizeDownloadLimit(body.downloadLimit)
  }
  if (body.clearPassword) {
    share.passwordHash = null
  } else if (Object.prototype.hasOwnProperty.call(body, 'password') && String(body.password || '').trim()) {
    share.passwordHash = hashSecret(String(body.password).trim())
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim()
    if (!['active', 'closed'].includes(status)) throw httpError(400, '分享状态不支持')
    share.status = status
    if (status === 'closed') removeDirectory(path.join(filesRoot, share.id))
  }
}

function applyCollectionUpdate(task, body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = String(body.title || '').trim()
    if (!title) throw httpError(400, '请填写任务名称')
    task.title = title
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    task.description = String(body.description || '').trim() || '请上传你负责的文件'
  }
  if (Object.prototype.hasOwnProperty.call(body, 'deadline')) {
    const deadline = normalizeExpiryInput(body.deadline, '截止时间')
    if (!deadline) throw httpError(400, '截止时间格式不正确')
    task.deadline = deadline
    if (task.status === 'expired' && new Date(task.deadline).getTime() > Date.now()) {
      task.status = 'active'
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'allowedTypes')) {
    const allowed = Array.isArray(body.allowedTypes) ? body.allowedTypes.map(String).filter((type) => ['图片', '文档', '视频', '其他'].includes(type)) : []
    task.allowedTypes = Array.from(new Set(allowed))
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxFileSizeMb')) {
    const maxFileSizeMb = Number(body.maxFileSizeMb)
    if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) throw httpError(400, '单人大小限制不正确')
    task.maxFileSizeMb = Math.floor(maxFileSizeMb)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim()
    if (!['active', 'closed'].includes(status)) throw httpError(400, '收集任务状态不支持')
    if (status === 'active' && new Date(task.deadline).getTime() <= Date.now()) {
      throw httpError(400, '截止时间已过，请先延长截止时间')
    }
    task.status = status
  }
}

function normalizeExpiryInput(value, label) {
  if (value === null || value === 'permanent' || value === 'unlimited') return null
  const raw = String(value || '').trim()
  if (!raw) return null
  let date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number)
    date = new Date(year, month - 1, day, 23, 59, 59, 999)
  } else {
    date = new Date(raw)
  }
  if (Number.isNaN(date.getTime())) throw httpError(400, `${label}格式不正确`)
  return date.toISOString()
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseRecipients(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '')
    .split(/[\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function findShareByCode(code) {
  return metadata.shares.find((share) => share.code.toLowerCase() === String(code).trim().toLowerCase())
}

function validateShare(share, password, { allowMissingPassword = false, hasAccessCookie = false } = {}) {
  if (share.status !== 'active') return { ok: false, status: 410, message: '分享已失效' }
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
    share.status = 'expired'
    removeDirectory(path.join(filesRoot, share.id))
    persistMetadata()
    return { ok: false, status: 410, message: '分享已过期' }
  }
  if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
    return { ok: false, status: 410, message: '下载次数已用完' }
  }
  if (hasAccessCookie && share.passwordHash) return { ok: true }
  if (allowMissingPassword && share.passwordHash && !password) return { ok: true }
  if (share.passwordHash && hashSecret(password || '') !== share.passwordHash) {
    return { ok: false, status: password ? 401 : 403, message: password ? '提取密码不正确' : '请输入提取密码' }
  }
  return { ok: true }
}

function validateCollection(task) {
  if (task.status !== 'active') return { ok: false, status: 410, message: '收集任务已关闭' }
  if (new Date(task.deadline).getTime() <= Date.now()) {
    task.status = 'expired'
    persistMetadata()
    return { ok: false, status: 410, message: '收集任务已截止' }
  }
  return { ok: true }
}

function getOrigin(req) {
  return getRequestOrigin(req)
}

function getRequestOrigin(req) {
  const proto = firstHeader(req.get('x-forwarded-proto')) || req.protocol
  const host = firstHeader(req.get('x-forwarded-host')) || req.get('host') || `localhost:${serverPort}`
  return `${proto}://${host}`
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim()
}

function firstValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function splitConfigValues(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function createToken(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
}

function createCode(requestedLength = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const length = Math.min(6, Math.max(4, Number(requestedLength) || 4))
  let code = ''
  do {
    code = Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (metadata.shares.some((share) => share.code === code))
  return code
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')).replace(/^(\.\.(\/|\\|$))+/, '')
  return normalized.replace(/^\/+/, '') || '未命名文件'
}

function isAllowedType(filename, allowedTypes) {
  if (!allowedTypes?.length || allowedTypes.includes('其他')) return true
  const extension = path.extname(filename).toLowerCase()
  const typeMap = {
    图片: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
    文档: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx'],
    视频: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
  }
  return allowedTypes.some((type) => typeMap[type]?.includes(extension))
}

function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    try { fs.unlinkSync(file.path) } catch {}
  }
}

function removeDirectory(directory) {
  try { fs.rmSync(directory, { recursive: true, force: true }) } catch {}
}

function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) continue
      const key = trimmed.slice(0, index).trim()
      let value = trimmed.slice(index + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {}
}
