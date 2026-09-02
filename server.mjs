import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import archiver from 'archiver'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storageRoot = path.join(__dirname, 'storage')
const tempRoot = path.join(storageRoot, 'tmp')
const filesRoot = path.join(storageRoot, 'files')
const collectionsRoot = path.join(storageRoot, 'collections')
const metadataPath = path.join(storageRoot, 'metadata.json')
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
const MAX_FILES = 100

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}

const metadata = loadMetadata()
const uploadSessions = new Map()
const upload = multer({
  dest: tempRoot,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
})
const app = express()

app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kunqiong-local-api', now: new Date().toISOString() })
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
    res.status(201).json({ share: publicShare(share, req) })
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
    res.status(201).json({ share: publicShare(share, req) })
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
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  const access = validateShare(share, undefined, { allowMissingPassword: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  res.json({ share: publicShare(share, req, !share.passwordHash), requiresPassword: Boolean(share.passwordHash) })
})

app.get('/api/shares/:token/download', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    const access = validateShare(share, req.get('x-share-password'))
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
      return res.status(410).json({ message: '下载次数已用完' })
    }
    share.downloadCount += 1
    persistMetadata()
    const shareDirectory = path.join(filesRoot, share.id)
    if (share.files.length === 1) {
      const file = share.files[0]
      res.download(path.join(shareDirectory, file.storedName), file.name)
      return
    }
    res.attachment('鲲穹文件包.zip')
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', next)
    archive.pipe(res)
    for (const file of share.files) {
      archive.file(path.join(shareDirectory, file.storedName), { name: file.relativePath })
    }
    await archive.finalize()
  } catch (error) {
    next(error)
  }
})

app.post('/api/collections', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim()
    if (!title) return res.status(400).json({ message: '请填写任务名称' })
    const token = createToken(10)
    const manageToken = createToken(18)
    const deadline = req.body.deadline ? new Date(req.body.deadline) : new Date(Date.now() + 7 * 86400000)
    if (Number.isNaN(deadline.getTime())) return res.status(400).json({ message: '截止时间格式不正确' })
    const task = {
      id: token,
      token,
      manageToken,
      title,
      description: String(req.body.description || '请上传你负责的文件'),
      deadline: deadline.toISOString(),
      allowedTypes: Array.isArray(req.body.allowedTypes) ? req.body.allowedTypes : [],
      maxFileSizeMb: Number(req.body.maxFileSizeMb || 500),
      createdAt: new Date().toISOString(),
      status: 'active',
      submissions: [],
    }
    task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${token}`, { width: 180, margin: 1 })
    metadata.collections.push(task)
    persistMetadata()
    res.status(201).json({ collection: publicCollection(task, req), manageToken })
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

app.get('/api/collections/manage/:manageToken/download', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    res.attachment(`${task.title}.zip`)
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', next)
    archive.pipe(res)
    for (const submission of task.submissions) {
      for (const file of submission.files) {
        archive.file(path.join(collectionsRoot, task.id, submission.id, file.storedName), {
          name: path.join(submission.participantName, file.relativePath),
        })
      }
    }
    await archive.finalize()
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/download', (req, res) => {
  const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
  if (!task) return res.status(404).json({ message: '管理链接不存在' })
  const submission = task.submissions.find((item) => item.id === req.params.submissionId)
  const file = submission?.files[Number(req.params.fileIndex)]
  if (!file) return res.status(404).json({ message: '文件不存在' })
  res.download(path.join(collectionsRoot, task.id, submission.id, file.storedName), file.name)
})

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '文件超过 5 GB 限制' })
  if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ message: `单次最多上传 ${MAX_FILES} 个文件` })
  res.status(500).json({ message: '服务器处理失败，请稍后重试' })
})

const server = app.listen(4174, '0.0.0.0', () => {
  console.log('鲲穹 API listening on http://localhost:4174')
})

const cleanupTimer = setInterval(cleanupExpired, 60 * 1000)
cleanupTimer.unref()
cleanupExpired()

function loadMetadata() {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch {
    return { shares: [], collections: [] }
  }
}

function persistMetadata() {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
}

function cleanupExpired() {
  const now = Date.now()
  let changed = false
  for (const share of metadata.shares) {
    if (share.status === 'active' && share.expiresAt && new Date(share.expiresAt).getTime() <= now) {
      share.status = 'expired'
      changed = true
      removeDirectory(path.join(filesRoot, share.id))
    }
  }
  for (const task of metadata.collections) {
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
  if (changed) persistMetadata()
}

function publicShare(share, req, includeFiles = true) {
  return {
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
}

function publicCollection(task, req) {
  return {
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
    manageUrl: `${getOrigin(req)}/collect/manage/${task.manageToken}`,
    qrDataUrl: task.qrDataUrl,
  }
}

function managerCollection(task, req) {
  return {
    ...publicCollection(task, req),
    manageToken: task.manageToken,
    submissions: task.submissions.map(publicSubmission),
    downloadUrl: `${getOrigin(req)}/api/collections/manage/${task.manageToken}/download`,
  }
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
    code: createCode(options.codeLength),
    files,
    createdAt: new Date().toISOString(),
    expiresAt: expiryDays === '0' ? null : new Date(Date.now() + Number(expiryDays) * 86400000).toISOString(),
    downloadLimit,
    downloadCount: 0,
    passwordHash: options.password ? hashSecret(options.password) : null,
    deliveryRecipients: options.recipients,
    notificationLog: options.recipients.map((recipient) => ({ recipient, status: '模拟已通知', sentAt: new Date().toISOString() })),
    status: 'active',
  }
  const shareUrl = `${getOrigin(req)}/share/${shareToken}`
  share.qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 180, margin: 1 })
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

function validateShare(share, password, { allowMissingPassword = false } = {}) {
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
  return `${req.protocol}://${req.get('host')}`.replace(':4174', ':4173')
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
