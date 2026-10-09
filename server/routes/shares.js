// shareCreate + shareAccess 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import path from 'node:path'

import {
  MAX_FILES, filesRoot
} from '../config.js'
import {
  parseJson
} from '../lib/http.js'
import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'
import {
  normalizeUploadedFileNames, upload
} from '../lib/upload.js'
import {
  accountUserById, authSessionFromRequest, safeRelativePath
} from '../services/account.js'
import {
  addGuestUsage, applyShareUpdate, assertConfiguredUploadLimits, assertGuestQuota,
  assertSafeUploadFiles, assertServiceWritable, cleanupUploadedFiles, createShareFromTempFiles,
  enforceDownloadOrigin, ensureStoredFilesScanned, findShareByCode, findShareByManageToken,
  publicShare, readShareOptions, registerShareDownload, reserveUploadCapacity,
  sendDownloadFile, sendPreviewFile, setShareAccessCookie, shareLookupRateLimited, streamZip,
  validateEnterpriseSlug, validateShareRequest
} from '../services/shares.js'
import {
  uploadReservations
} from '../state.js'

export function registerShareCreateRoutes(app) {
  app.post('/api/shares', upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
  let reservationId
  try {
    assertServiceWritable(req)
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) return res.status(400).json({ message: '至少选择一个文件' })
    assertConfiguredUploadLimits(req, uploadedFiles)
    const guestKey = assertGuestQuota(req, res, uploadedFiles)
    const ownerSession = authSessionFromRequest(req)
    const options = readShareOptions(req.body, ownerSession?.user)
    reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, ownerUserId: ownerSession?.user?.id || '' })
    await assertSafeUploadFiles(uploadedFiles)

    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      return {
        name: file.originalname,
        relativePath,
        size: file.size,
        mimeType: file.mimetype || 'application/octet-stream',
        tempPath: file.path,
        reviewStatus: file.reviewStatus,
        scanEngine: file.scanEngine,
        scannedAt: file.scannedAt,
      }
    })

    const share = await createShareFromTempFiles(files, options, req)
    addGuestUsage(guestKey, files)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
  } finally {
    if (reservationId) uploadReservations.delete(reservationId)
  }
})
}

export function registerShareAccessRoutes(app) {
  app.get('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  if (share.passwordHash) return res.json({ share: publicShare(share, req, false), requiresPassword: true })
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})
  app.post('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { password: req.body.password, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  setShareAccessCookie(res, req, share)
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})
  app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  if (!validateEnterpriseSlug(share, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  const viewer = authSessionFromRequest(req)?.user
  const includeManage = Boolean(viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId)
  res.json({ share: publicShare(share, req, !share.passwordHash, includeManage), requiresPassword: Boolean(share.passwordHash) })
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
    applyShareUpdate(share, req.body || {}, accountUserById(share.ownerUserId))
    share.updatedAt = new Date().toISOString()
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
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    await ensureStoredFilesScanned(share.files, path.join(filesRoot, share.id))
    if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
    registerShareDownload(share, res)
    const shareDirectory = path.join(filesRoot, share.id)
    if (share.files.length === 1) {
      const file = share.files[0]
      sendDownloadFile(req, res, next, path.join(shareDirectory, file.storedName), file)
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
  app.get('/api/shares/:token/files/:fileIndex/download', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    await ensureStoredFilesScanned([file], path.join(filesRoot, share.id))
    if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
    registerShareDownload(share, res)
    sendDownloadFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})
  app.get('/api/shares/:token/files/:fileIndex/preview', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    await ensureStoredFilesScanned([file], path.join(filesRoot, share.id))
    sendPreviewFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})
}
