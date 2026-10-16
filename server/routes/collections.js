// collections 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import {
  COLLECTION_DESCRIPTION_MAX, COLLECTION_TITLE_MAX, MAX_FILES, collectionsRoot
} from '../config.js'
import {
  createToken, httpError, removeDirectory
} from '../lib/http.js'
import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'
import {
  normalizeUploadedFileNames, upload
} from '../lib/upload.js'
import {
  accountUserById, authSessionFromRequest, getOrigin, safeRelativePath
} from '../services/account.js'
import {
  applyCollectionUpdate, collectionZipEntries, ensureCollectionQrDataUrl, managerCollection,
  publicCollection
} from '../services/collections.js'
import {
  assertAccountCapacity, assertCollectionFiles,
  assertConfiguredUploadLimits, assertFilesDownloadable, assertGuestQuota,
  assertSafeUploadFiles, assertServiceWritable, assertUploadCapacity, cleanupUploadedFiles,
  enforceDownloadOrigin, ensureStoredFilesScanned, guestQuotaLimitBytes, isAllowedType,
  normalizeExpiryInput, publicSubmission, publishCollectionSubmission,
  reserveUploadCapacity, resolveCollectionSubmitter, sendDownloadFile, sendPreviewFile,
  streamZip, validateCollection, validateEnterpriseSlug, prepareDirectUpload,
} from '../services/shares.js'
import {
  uploadReservations
} from '../state.js'
import path from 'node:path'
import QRCode from 'qrcode'
import { integerInput, textInput } from '../lib/input-validation.js'
import { relativePathsInput, uniqueFilePaths } from '../lib/file-input.js'
import { collectionTypesInput } from '../services/shares.js'

function assertCollectionManager(task, req) {
  // Anonymous collections intentionally remain bearer-link managed. Once a
  // task belongs to an account, its management token is only an identifier;
  // the owner session is the authorization boundary for data and mutations.
  if (!task.ownerUserId) return
  const viewer = authSessionFromRequest(req)?.user
  if (!viewer) throw httpError(401, '请先登录任务所有者账号')
  if (viewer.id !== task.ownerUserId) throw httpError(403, '仅任务所有者可以管理该收集任务')
}

function assertCollectionStillManaged(task, req) {
  if (!metadata.collections.includes(task)) throw httpError(404, '管理链接不存在')
  assertCollectionManager(task, req)
}

export function registerCollectionRoutes(app) {
  app.post('/api/collections', async (req, res, next) => {
    try {
      assertServiceWritable(req)
      const ownerSession = authSessionFromRequest(req)
      // 与 applyCollectionUpdate 保持一致的服务端校验：
      // 标题/说明超长直接拒绝（400 + 可理解的错误信息，不再静默截断入库），
      // 单人大小限制必须为有限正数（此前负数/NaN 会被接受并创建出「永远无法提交」的废任务）。
      const title = textInput(req.body.title, '任务名称', COLLECTION_TITLE_MAX)
      if (!title) return res.status(400).json({ message: '请填写任务名称' })
      if (title.length > COLLECTION_TITLE_MAX) return res.status(400).json({ message: `任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字` })
      const maxFileSizeMbRaw = integerInput(req.body.maxFileSizeMb ?? 500,'单文件大小限制',1,5120)
      if (!Number.isFinite(maxFileSizeMbRaw) || maxFileSizeMbRaw <= 0) return res.status(400).json({ message: '单人大小限制不正确' })
      const descriptionRaw = textInput(req.body.description ?? '', '收集说明', COLLECTION_DESCRIPTION_MAX, {optional:true,multiline:true})
      if (descriptionRaw.length > COLLECTION_DESCRIPTION_MAX) return res.status(400).json({ message: `收集说明不能超过 ${COLLECTION_DESCRIPTION_MAX} 个字` })
      const description = descriptionRaw || '请上传你负责的文件'
      const token = createToken(10)
      const manageToken = createToken(18)
      const deadline = normalizeExpiryInput(req.body.deadline === undefined ? new Date(Date.now() + 7 * 86400000).toISOString() : req.body.deadline, '截止时间')
      if (!deadline) return res.status(400).json({ message: '截止时间格式不正确' })
      if (new Date(deadline).getTime() <= Date.now()) return res.status(400).json({ message: '截止时间必须晚于当前时间' })
      const task = {
        id: token,
        token,
        manageToken,
        title,
        description,
        deadline,
        allowedTypes: req.body.allowedTypes === undefined ? ['全部格式'] : collectionTypesInput(req.body.allowedTypes),
        maxFileSizeMb: Math.floor(maxFileSizeMbRaw),
        capacityBytes: ownerSession?.user?.id ? null : guestQuotaLimitBytes() || 1024 * 1024 * 1024,
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
  app.get('/api/collections/:token', async (req, res, next) => {
    try {
      const task = metadata.collections.find((item) => item.token === req.params.token)
      if (!task) return res.status(404).json({ message: '收集任务不存在' })
      if (!validateEnterpriseSlug(task, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
      const access = validateCollection(task)
      if (!access.ok) return res.status(access.status).json({ message: access.message })
      if (await ensureCollectionQrDataUrl(task, req)) persistMetadata()
      res.json({ collection: publicCollection(task, req) })
    } catch (error) {
      next(error)
    }
  })
  app.post('/api/collections/:token/submissions', prepareDirectUpload, upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
    let reservationId
    try {
      assertServiceWritable(req)
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
      const submitter = resolveCollectionSubmitter(req)
      const participantName = submitter.participantName
      if (!participantName) {
        cleanupUploadedFiles(req.files)
        return res.status(400).json({ message: '请先登录，或填写提交人名称' })
      }
      const uploadedFiles = req.files || []
      if (!uploadedFiles.length) {
        return res.status(400).json({ message: '至少选择一个文件' })
      }
      const relativePaths = relativePathsInput(req.body.relativePaths, uploadedFiles)
      uniqueFilePaths(uploadedFiles.map((file,index) => ({ relativePath:relativePaths[index] })))
      assertConfiguredUploadLimits(req, uploadedFiles)
      const guestKey = assertGuestQuota(req, res, uploadedFiles)
      assertCollectionFiles(task, uploadedFiles)
      reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, collectionToken: task.token, capacityOwnerUserId: task.ownerUserId }, req.directUploadReservationId)
      await assertSafeUploadFiles(uploadedFiles)
      const invalidFile = uploadedFiles.find((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname, task.allowedTypes))
      if (invalidFile) {
        cleanupUploadedFiles(uploadedFiles)
        return res.status(413).json({ message: `${invalidFile.originalname} 不符合当前收集任务的文件限制` })
      }
      assertAccountCapacity(accountUserById(task.ownerUserId), uploadedFiles.reduce((sum, file) => sum + file.size, 0))
      assertUploadCapacity(uploadReservations.get(reservationId), reservationId)
      const finalAccess = validateCollection(task)
      if (!finalAccess.ok) throw httpError(finalAccess.status, finalAccess.message)
      assertCollectionFiles(task, uploadedFiles)
      const files = uploadedFiles.map((file, index) => {
        const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
        return { name: file.originalname, relativePath, tempPath: file.path, size: file.size, mimeType: file.mimetype || 'application/octet-stream', reviewStatus: file.reviewStatus, scanEngine: file.scanEngine, scannedAt: file.scannedAt }
      })
      const submission = await publishCollectionSubmission(task, files, submitter, req, { guestKey })
      res.status(201).json({ submission: publicSubmission(submission) })
    } catch (error) {
      cleanupUploadedFiles(req.files)
      next(error)
    } finally {
      if (reservationId) uploadReservations.delete(reservationId)
    }
  })
  app.get('/api/collections/manage/:manageToken', async (req, res, next) => {
    try {
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      if (await ensureCollectionQrDataUrl(task, req)) persistMetadata()
      res.json({ collection: managerCollection(task, req) })
    } catch (error) {
      next(error)
    }
  })
  app.patch('/api/collections/manage/:manageToken', async (req, res, next) => {
    try {
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      applyCollectionUpdate(task, req.body || {})
      await ensureCollectionQrDataUrl(task, req)
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
      assertCollectionManager(metadata.collections[index], req)
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
      assertCollectionManager(task, req)
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
      enforceDownloadOrigin(req)
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      assertFilesDownloadable(task.submissions.flatMap((submission) => submission.files || []))
      for (const submission of task.submissions) await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
      assertCollectionStillManaged(task, req)
      const entries = collectionZipEntries(task)
      if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
      await streamZip(res, next, `${task.title || '收集文件'}.zip`, entries)
    } catch (error) {
      next(error)
    }
  })
  app.get('/api/collections/manage/:manageToken/submissions/:submissionId/download', async (req, res, next) => {
    try {
      enforceDownloadOrigin(req)
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      if (!submission) return res.status(404).json({ message: '提交记录不存在' })
      assertFilesDownloadable(submission.files || [])
      await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
      assertCollectionStillManaged(task, req)
      if (!task.submissions.includes(submission)) return res.status(404).json({ message: '提交记录不存在' })
      const entries = collectionZipEntries(task, submission)
      if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
      await streamZip(res, next, `${submission.participantName || '提交文件'}.zip`, entries)
    } catch (error) {
      next(error)
    }
  })
  app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/download', async (req, res, next) => {
    try {
      enforceDownloadOrigin(req)
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      const file = submission?.files[Number(req.params.fileIndex)]
      if (!file) return res.status(404).json({ message: '文件不存在' })
      assertFilesDownloadable([file])
      await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
      assertCollectionStillManaged(task, req)
      if (!task.submissions.includes(submission) || submission.files?.[Number(req.params.fileIndex)] !== file) return res.status(404).json({ message: '文件不存在' })
      sendDownloadFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
    } catch (error) {
      next(error)
    }
  })
  app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/preview', async (req, res, next) => {
    try {
      enforceDownloadOrigin(req)
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertCollectionManager(task, req)
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      const file = submission?.files[Number(req.params.fileIndex)]
      if (!file) return res.status(404).json({ message: '文件不存在' })
      assertFilesDownloadable([file])
      await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
      assertCollectionStillManaged(task, req)
      if (!task.submissions.includes(submission) || submission.files?.[Number(req.params.fileIndex)] !== file) return res.status(404).json({ message: '文件不存在' })
      sendPreviewFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
    } catch (error) {
      next(error)
    }
  })
}
