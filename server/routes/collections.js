// collections 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import {
  MAX_FILES, collectionsRoot
} from '../config.js'
import {
  createToken, httpError, parseJson, removeDirectory
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
  addCollectionSubmissionMessage, addGuestUsage, assertAccountCapacity, assertCollectionFiles,
  assertConfiguredUploadLimits, assertFilesDownloadable, assertGuestQuota,
  assertSafeUploadFiles, assertServiceWritable, assertUploadCapacity, cleanupUploadedFiles,
  enforceDownloadOrigin, ensureStoredFilesScanned, guestQuotaLimitBytes, isAllowedType,
  normalizeCollectionAllowedTypes, normalizeExpiryInput, publicSubmission,
  reserveUploadCapacity, resolveCollectionSubmitter, sendDownloadFile, sendPreviewFile,
  streamZip, validateCollection, validateEnterpriseSlug
} from '../services/shares.js'
import {
  uploadReservations
} from '../state.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

export function registerCollectionRoutes(app) {
  app.post('/api/collections', async (req, res, next) => {
    try {
      assertServiceWritable(req)
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
        allowedTypes: normalizeCollectionAllowedTypes(req.body.allowedTypes),
        maxFileSizeMb: Number(req.body.maxFileSizeMb || 500),
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
  app.post('/api/collections/:token/submissions', upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
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
      assertConfiguredUploadLimits(req, uploadedFiles)
      const guestKey = assertGuestQuota(req, res, uploadedFiles)
      assertCollectionFiles(task, uploadedFiles)
      reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, collectionToken: task.token, capacityOwnerUserId: task.ownerUserId })
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
      const submissionId = createToken(12)
      const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
      fs.mkdirSync(submissionDirectory, { recursive: true })
      const relativePaths = parseJson(req.body.relativePaths, [])
      const files = uploadedFiles.map((file, index) => {
        const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
        const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
        fs.renameSync(file.path, path.join(submissionDirectory, storedName))
        return { name: file.originalname, relativePath, storedName, size: file.size, mimeType: file.mimetype || 'application/octet-stream', reviewStatus: file.reviewStatus, scanEngine: file.scanEngine, scannedAt: file.scannedAt }
      })
      const submission = {
        id: submissionId,
        participantName,
        submitterUserId: submitter.submitterUserId,
        submitterName: submitter.submitterName || participantName,
        submittedAt: new Date().toISOString(),
        files,
      }
      task.submissions.push(submission)
      addCollectionSubmissionMessage(task, submission, req)
      addGuestUsage(guestKey, files)
      persistMetadata()
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
      enforceDownloadOrigin(req)
      const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
      if (!task) return res.status(404).json({ message: '管理链接不存在' })
      assertFilesDownloadable(task.submissions.flatMap((submission) => submission.files || []))
      for (const submission of task.submissions) await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
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
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      if (!submission) return res.status(404).json({ message: '提交记录不存在' })
      assertFilesDownloadable(submission.files || [])
      await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
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
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      const file = submission?.files[Number(req.params.fileIndex)]
      if (!file) return res.status(404).json({ message: '文件不存在' })
      assertFilesDownloadable([file])
      await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
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
      const submission = task.submissions.find((item) => item.id === req.params.submissionId)
      const file = submission?.files[Number(req.params.fileIndex)]
      if (!file) return res.status(404).json({ message: '文件不存在' })
      assertFilesDownloadable([file])
      await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
      sendPreviewFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
    } catch (error) {
      next(error)
    }
  })
}
