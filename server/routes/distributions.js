import { createToken, httpError } from '../lib/http.js'
import { buildDistributionPreview } from '../lib/distributions.js'
import { metadata } from '../lib/metadata-store.js'
import { upload, normalizeUploadedFileNames } from '../lib/upload.js'
import { cleanupUploadedFiles, createShareFromTempFiles, prepareDirectUpload, readShareOptions, assertSafeUploadFiles, publicShare } from '../services/shares.js'
import { accountUserById, authSessionFromRequest, requireAuthSession } from '../services/account.js'
import { normalizeSystemConfig } from '../lib/metadata-normalizers.js'

const publishLocks = new Map()

function usersForMatching() {
  return Object.values(metadata.users || {}).map(user => ({
    id: user.id, username: user.username, email: user.email, phone: user.phone,
    nickname: user.nickname, status: user.status,
  }))
}

function publicDistribution(item, req) {
  return {
    id: item.id,
    status: item.status,
    createdAt: item.createdAt,
    frozenAt: item.frozenAt,
    shareId: item.shareId,
    rowCount: item.rows?.length || 0,
    rows: (item.rows || []).map(row => ({ ...row })),
    shareUrl: item.shareId ? `${req.protocol}://${req.get('host')}/share/${item.shareId}` : '',
  }
}

function rosterBody(body) {
  return body?.roster ?? body?.recipients ?? body?.recipientList ?? ''
}

// 前端逐条核对后的配对结果，multipart 里以 JSON 字符串提交。
function assignmentsBody(body) {
  const raw = body?.assignments ?? body?.pairs ?? null
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// 收件人看到的是去掉“编号__”前缀的原文件名；同名文件保留原样避免混淆。
function shareFileNames(files, rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.displayName, (counts.get(row.displayName) || 0) + 1)
  return files.map((file, index) => {
    const row = rows.find(item => item.fileIndex === index)
    const displayName = row && counts.get(row.displayName) === 1 ? row.displayName : ''
    return { row, name: displayName || row?.fileName || file.originalname }
  })
}

function idempotencyKey(req) {
  const value = req.get('Idempotency-Key') || req.body?.idempotencyKey || ''
  const key = String(value).trim()
  return key.length >= 8 && key.length <= 200 ? key : ''
}

function findExisting(ownerUserId, key) {
  return metadata.distributions.find(item => item.ownerUserId === ownerUserId && item.idempotencyKey === key) || null
}

async function withPublishLock(key, task) {
  const previous = publishLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  publishLocks.set(key, current)
  await previous.catch(() => {})
  try { return await task() } finally {
    release()
    if (publishLocks.get(key) === current) publishLocks.delete(key)
  }
}

export function registerDistributionRoutes(app) {
  app.post('/api/distributions/preview', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const files = Array.isArray(req.body?.files) ? req.body.files.map(name => ({ name })) : []
    const preview = buildDistributionPreview({ files, roster: rosterBody(req.body), assignments: assignmentsBody(req.body), users: usersForMatching() })
    res.json({ preview })
  })

  app.get('/api/distributions/:id', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const item = metadata.distributions.find(candidate => candidate.id === req.params.id)
    if (!item) return res.status(404).json({ message: '分发记录不存在' })
    if (item.ownerUserId !== session.user.id) return res.status(403).json({ message: '无权查看此分发记录' })
    const share = metadata.shares.find(candidate => candidate.id === item.shareId)
    res.json({ distribution: publicDistribution(item, req), share: share ? publicShare(share, req, true, true) : null })
  })

  app.post('/api/distributions', prepareDirectUpload, upload.array('files'), normalizeUploadedFileNames, async (req, res, next) => {
    try {
      const session = authSessionFromRequest(req)
      const files = req.files || []
      if (!session?.user?.id) {
        cleanupUploadedFiles(files)
        return res.status(401).json({ message: '请先登录后发布定向分发' })
      }
      const key = idempotencyKey(req)
      if (!key) {
        cleanupUploadedFiles(files)
        return res.status(400).json({ message: '请提供至少 8 个字符的 Idempotency-Key' })
      }
      const preview = buildDistributionPreview({ files, roster: rosterBody(req.body), assignments: assignmentsBody(req.body), users: usersForMatching() })
      if (!preview.ok) {
        cleanupUploadedFiles(files)
        return res.status(400).json({ message: '分发匹配存在问题，请修正后再发布', preview })
      }
      const ownerUser = accountUserById(session.user.id) || session.user
      const existing = findExisting(session.user.id, key)
      if (existing) {
        cleanupUploadedFiles(files)
        const share = metadata.shares.find(candidate => candidate.id === existing.shareId)
        return res.json({ distribution: publicDistribution(existing, req), share: share ? publicShare(share, req, true, true) : null, reused: true })
      }
      const config = normalizeSystemConfig(metadata.systemConfig)
      // readShareOptions 需要接收原始手机号、邮箱或账号来做格式和本人校验。
      // 不能把 preview.recipientUserIds（可能是纯数字的内部用户 ID）当作
      // recipients 传入，否则像用户 ID「706」会被误判为非法手机号，导致
      // 明明已经匹配成功的收件人仍提示“手机号或邮箱格式不正确”。
      const matchedRecipients = preview.rows.map(row => row.recipient).filter(Boolean)
      const options = readShareOptions({
        recipients: matchedRecipients,
        expiryDays: req.body?.expiryDays || config.defaultShareDays,
        downloadLimit: req.body?.downloadLimit || 'unlimited',
        codeLength: req.body?.codeLength || 6,
      }, ownerUser, false)
      const distributionId = createToken(14)
      const fileRecipientUserIds = files.map((_, index) => preview.rows.find(row => row.fileIndex === index)?.userId || '')
      const distributionRecord = {
        id: distributionId, ownerUserId: session.user.id, idempotencyKey: key,
        status: 'published', createdAt: new Date().toISOString(), frozenAt: new Date().toISOString(),
        rows: preview.rows.map(row => ({ key: row.key, userId: row.userId, recipient: row.recipient, fileName: row.fileName })),
      }
      await assertSafeUploadFiles(files)
      const namedFiles = shareFileNames(files, preview.rows)
      const share = await withPublishLock(`${session.user.id}:${key}`, async () => {
        const concurrent = findExisting(session.user.id, key)
        if (concurrent) return metadata.shares.find(candidate => candidate.id === concurrent.shareId)
        return createShareFromTempFiles(namedFiles.map(({ name }, index) => ({
          name, relativePath: files[index].originalname, size: files[index].size, mimeType: files[index].mimetype,
          tempPath: files[index].path, reviewStatus: files[index].reviewStatus, scanEngine: files[index].scanEngine, scannedAt: files[index].scannedAt,
          ...(name !== files[index].originalname ? { originalName: files[index].originalname } : {}),
        })), { ...options, distributionId, distributionRecipientUserIds: fileRecipientUserIds, distributionRecord }, req)
      })
      if (!share) throw httpError(503, '分发发布状态不确定，请稍后查询分发记录')
      const existingAfter = findExisting(session.user.id, key)
      if (existingAfter && existingAfter.id !== distributionId) {
        cleanupUploadedFiles(files)
        return res.json({ distribution: publicDistribution(existingAfter, req), share: publicShare(share, req, true, true), reused: true })
      }
      const item = metadata.distributions.find(candidate => candidate.id === distributionId)
      if (!item) throw httpError(503, '分发记录保存失败，请稍后查询')
      res.status(201).json({ distribution: publicDistribution(item, req), share: publicShare(share, req, true, true), reused: false })
    } catch (error) {
      cleanupUploadedFiles(req.files)
      next(error)
    }
  })
}

