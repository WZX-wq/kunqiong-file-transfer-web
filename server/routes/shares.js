// shareCreate + shareAccess 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import path from 'node:path'
import { relativePathsInput, uniqueFilePaths } from '../lib/file-input.js'

import {
  MAX_FILES, filesRoot
} from '../config.js'
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
  prepareDirectUpload, publicShare, readShareOptions, registerShareDownload, reserveUploadCapacity,
  sendDownloadFile, sendPreviewFile, setShareAccessCookie, shareLookupRateLimited, streamZip,
  validateEnterpriseSlug, validateShareRequest, validateTeamShareManager
} from '../services/shares.js'
import {
  uploadReservations
} from '../state.js'
import { httpError } from '../lib/http.js'

function validateManagedFileAccess(share, req) {
  const access = validateTeamShareManager(share, req)
  if (!access.ok) return access
  if (share.teamResource) return validateShareRequest(share, req, { allowOwner: true })
  if (!share.ownerUserId) return access
  const viewer = authSessionFromRequest(req)?.user
  if (!viewer) return { ok: false, status: 401, message: '请先登录文件所属账号' }
  if (viewer.id !== share.ownerUserId) return { ok: false, status: 403, message: '无权访问其他账号的文件' }
  return { ok: true }
}

export function registerShareCreateRoutes(app) {
  app.post('/api/shares', prepareDirectUpload, upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
  let reservationId
  try {
    assertServiceWritable(req)
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) return res.status(400).json({ message: '至少选择一个文件' })
    const relativePaths = relativePathsInput(req.body.relativePaths, uploadedFiles)
    uniqueFilePaths(relativePaths.map(relativePath => ({relativePath})))
    assertConfiguredUploadLimits(req, uploadedFiles)
    const guestKey = assertGuestQuota(req, res, uploadedFiles)
    const ownerSession = authSessionFromRequest(req)
    if (req.body.mode !== undefined && req.body.mode !== req.directUploadMode) throw httpError(400, '上传模式与接收入口不一致，团队文件请使用团队上传入口')
    const options = readShareOptions(req.body, ownerSession?.user, req.directUploadMode === 'team_resource')
    options.teamOrganizationId = req.uploadOrganizationId || ''
    reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, organizationId: options.teamOrganizationId, ownerUserId: ownerSession?.user?.id || '' }, req.directUploadReservationId)
    await assertSafeUploadFiles(uploadedFiles)

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
    uniqueFilePaths(files)

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
  app.post('/api/shares/manage/:manageToken/unlock', (req, res) => {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    const manager = validateTeamShareManager(share, req)
    if (!manager.ok) return res.status(manager.status).json({ message: manager.message })
    const access = validateShareRequest(share, req, { password: req.body.password, allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
    setShareAccessCookie(res, req, share)
    res.json({ ok: true })
  })
  // 团队管理下载与公开下载共用密码校验、次数预留和成功计数。
  app.get('/api/shares/manage/:manageToken/download', async (req, res, next) => {
    try {
      const share = findShareByManageToken(req.params.manageToken)
      if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
      const access = validateManagedFileAccess(share, req)
      if (!access.ok) return res.status(access.status).json({ message: access.message })
      enforceDownloadOrigin(req)
      await ensureStoredFilesScanned(share.files, path.join(filesRoot, share.id))
      // 扫描期间可能删除资源、移除成员、撤销角色或使会话失效，发送前重新校验。
      if (findShareByManageToken(req.params.manageToken) !== share) return res.status(404).json({ message: '分享管理链接不存在' })
      const currentAccess = validateManagedFileAccess(share, req)
      if (!currentAccess.ok) return res.status(currentAccess.status).json({ message: currentAccess.message })
      if (share.teamResource) {
        if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
        registerShareDownload(share, res)
      }
      if (share.files.length === 1) {
        const file = share.files[0]
        return sendDownloadFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
      }
      await streamZip(res, next, '鲲穹文件包.zip', share.files.map(file => ({ path: path.join(filesRoot, share.id, file.storedName), name: file.relativePath || file.name, size: file.size })))
    } catch (error) { next(error) }
  })
  // 管理文件与公开提取使用不同入口；账号文件仍需本人登录，游客使用管理令牌。
  for (const action of ['preview', 'download']) {
    app.get(`/api/shares/manage/:manageToken/files/:fileIndex/${action}`, async (req, res, next) => {
      try {
        const share = findShareByManageToken(req.params.manageToken)
        if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
        const access = validateManagedFileAccess(share, req)
        if (!access.ok) return res.status(access.status).json({ message: access.message })
        enforceDownloadOrigin(req)
        const file = share.files[Number(req.params.fileIndex)]
        if (!file) return res.status(404).json({ message: '文件不存在' })
        await ensureStoredFilesScanned([file], path.join(filesRoot, share.id))
        if (findShareByManageToken(req.params.manageToken) !== share) return res.status(404).json({ message: '分享管理链接不存在' })
        const currentAccess = validateManagedFileAccess(share, req)
        if (!currentAccess.ok) return res.status(currentAccess.status).json({ message: currentAccess.message })
        if (share.teamResource) {
          if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
          if (action === 'download') registerShareDownload(share, res)
        }
        const send = action === 'preview' ? sendPreviewFile : sendDownloadFile
        send(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
      } catch (error) {
        next(error)
      }
    })
  }
// 410（已过期/已关闭/次数用尽）时附带脱敏元信息：只有时间、文件数量与总大小，
// 不含文件名、下载地址或账号信息，供公开页渲染原型里的「已过期」状态卡。
function shareGonePayload(share, access) {
  const payload = { message: access.message, code: access.code || '' }
  if (access.status !== 410) return payload
  const expiresAt = share.expiresAt || ''
  const expired = share.closeReason === 'expired' || Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now())
  const exhausted = Boolean(share.downloadLimit && share.downloadCount >= share.downloadLimit)
  const files = Array.isArray(share.files) ? share.files : []
  return {
    message: access.message,
    code: access.code || (expired ? 'share_expired' : exhausted ? 'share_exhausted' : 'share_closed'),
    share: {
      state: expired ? 'expired' : exhausted ? 'exhausted' : 'closed',
      expiresAt,
      fileCount: files.length,
      totalSize: files.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
    },
  }
}

app.get('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json(shareGonePayload(share, access))
  if (share.passwordHash) return res.json({ share: publicShare(share, req, false), requiresPassword: true })
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})
  app.post('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { password: req.body.password, allowOwner: true })
  if (!access.ok) return res.status(access.status).json(shareGonePayload(share, access))
  setShareAccessCookie(res, req, share)
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})
  app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  if (!validateEnterpriseSlug(share, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json(shareGonePayload(share, access))
  const viewer = authSessionFromRequest(req)?.user
  const includeManage = Boolean(viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId)
  res.json({ share: publicShare(share, req, !share.passwordHash, includeManage), requiresPassword: Boolean(share.passwordHash) })
})
  app.get('/api/shares/manage/:manageToken', (req, res) => {
  const share = findShareByManageToken(req.params.manageToken)
  if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    const access = validateTeamShareManager(share, req)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
  res.json({ share: publicShare(share, req, true, true) })
})
  app.patch('/api/shares/manage/:manageToken', async (req, res, next) => {
  try {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    const access = validateTeamShareManager(share, req)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
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
    const access = validateTeamShareManager(share, req)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
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
    if (!metadata.shares.includes(share)) return res.status(404).json({ message: '分享不存在或已失效' })
    const currentAccess = validateShareRequest(share, req, { allowOwner: true })
    if (!currentAccess.ok) return res.status(currentAccess.status).json({ message: currentAccess.message })
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
    if (!metadata.shares.includes(share)) return res.status(404).json({ message: '分享不存在或已失效' })
    const currentAccess = validateShareRequest(share, req, { allowOwner: true })
    if (!currentAccess.ok) return res.status(currentAccess.status).json({ message: currentAccess.message })
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
    if (!metadata.shares.includes(share)) return res.status(404).json({ message: '分享不存在或已失效' })
    const currentAccess = validateShareRequest(share, req, { allowOwner: true })
    if (!currentAccess.ok) return res.status(currentAccess.status).json({ message: currentAccess.message })
    if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
    sendPreviewFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})
}
