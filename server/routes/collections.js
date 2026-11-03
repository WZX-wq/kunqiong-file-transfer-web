import { assertActiveCollectionLimit, assertCollectionParticipant, personalEntitlements } from '../services/entitlements.js'
// collections 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import {
  COLLECTION_DESCRIPTION_MAX, COLLECTION_TITLE_MAX, MAX_FILES, collectionsRoot, userFilesRoot
} from '../config.js'
import {
  createToken, httpError, removeDirectory
} from '../lib/http.js'
import { removeStoredFiles, resolveStoredFilePath } from '../lib/file-storage.js'
import {
  metadata, persistMetadata, flushMetadataWrites
} from '../lib/metadata-store.js'
import {
  normalizeUploadedFileNames, upload
} from '../lib/upload.js'
import {
  accountUserById, authSessionFromRequest, getOrigin, safeRelativePath
} from '../services/account.js'
import {
  applyCollectionUpdate, collectionClosedMeta, collectionZipEntries, ensureCollectionQrDataUrl, managerCollection,
  publicCollection
} from '../services/collections.js'
import {
  assertAccountCapacity, assertCollectionFiles,
  assertConfiguredUploadLimits, assertFilesDownloadable, assertGuestQuota,
  assertSafeUploadFiles, assertServiceWritable, assertUploadCapacity, cleanupUploadedFiles,
  enforceDownloadOrigin, ensureStoredFilesScanned, guestQuotaLimitBytes, isAllowedType,
  normalizeExpiryInput, publicSubmission, publishCollectionSubmission,
  reserveUploadCapacity, resolveCollectionSubmitter, sendDownloadFile, sendPreviewFile,
  enterpriseOrganizationForUser,
  streamZip, validateCollection, validateEnterpriseSlug, prepareDirectUpload, resolveGuestKey,
} from '../services/shares.js'
import {
  uploadReservations
} from '../state.js'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { keyedDigest } from '../lib/private-key.js'
import { currentDataContext } from '../lib/data-context.js'
import { acquireOperationLock } from '../lib/operation-lock.js'
import QRCode from 'qrcode'
import { integerInput, textInput } from '../lib/input-validation.js'
import { relativePathsInput, uniqueFilePaths } from '../lib/file-input.js'
import { collectionTypesInput } from '../services/shares.js'
import { normalizeCollectionCustomFields, normalizeCollectionMaterials, validateCollectionSubmissionInput } from '../lib/collection-forms.js'

function storedCollectionFilePath(task, submission, file) {
  return resolveStoredFilePath(file, path.join(collectionsRoot, task.id, submission.id), userFilesRoot)
}

function assertCollectionManager(task, req) {
  // Anonymous collections intentionally remain bearer-link managed. Once a
  // task belongs to an account, its management token is only an identifier;
  // the owner session is the authorization boundary for data and mutations.
  if (!task.ownerUserId) return
  const viewer = authSessionFromRequest(req)?.user
  if (!viewer) throw httpError(401, '请先登录任务所有者账号')
  if (viewer.id !== task.ownerUserId) throw Object.assign(httpError(403,
    `当前账号${viewer.username ? `（${viewer.username}）` : ''}不是此任务的所有者，请切换创建任务的账号`), { code: 'collection_owner_required' })
}

function assertCollectionStillManaged(task, req) {
  if (!metadata.collections.includes(task)) throw httpError(404, '管理链接不存在')
  assertCollectionManager(task, req)
}

export function registerCollectionRoutes(app) {
  app.post('/api/collections', async (req, res, next) => {
    let releaseCreation = () => {}
    try {
      assertServiceWritable(req)
      const ownerSession = authSessionFromRequest(req)
      const ownerGuestKey = ownerSession?.user?.id ? '' : resolveGuestKey(req, res)
      const entitlement = personalEntitlements(ownerSession?.user?.id)
      const source = req.body || {}
      const creationKey = String(req.get('Idempotency-Key') || source.idempotencyKey || '').trim()
      if (creationKey && (creationKey.length < 8 || creationKey.length > 200)) {
        return res.status(400).json({ message: 'Idempotency-Key 长度必须为 8 至 200 个字符' })
      }
      // A deterministic, private identity is a bounded PK lookup in MySQL and
      // also its uniqueness boundary across processes and server restarts.
      const creationId = creationKey ? keyedDigest(`collection-create:${JSON.stringify([ownerSession?.user?.id || `guest:${ownerGuestKey}`, creationKey])}`).slice(0, 32) : ''
      if (creationId) {
        releaseCreation = await acquireOperationLock(`collection-create:${creationId}`)
        await currentDataContext()?.store?.resource({ kind: 'collection', id: creationId })
      }
      // 与 applyCollectionUpdate 保持一致的服务端校验：
      // 标题/说明超长直接拒绝（400 + 可理解的错误信息，不再静默截断入库），
      // 单人大小限制必须为有限正数（此前负数/NaN 会被接受并创建出「永远无法提交」的废任务）。
      const title = textInput(source.title, '任务名称', COLLECTION_TITLE_MAX)
      if (!title) return res.status(400).json({ message: '请填写任务名称' })
      if (title.length > COLLECTION_TITLE_MAX) return res.status(400).json({ message: `任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字` })
      const maxFileSizeMbRaw = integerInput(source.maxFileSizeMb ?? 500,'单文件大小限制',1,Math.floor(entitlement.singleFileLimitBytes / 1024 ** 2))
      if (!Number.isFinite(maxFileSizeMbRaw) || maxFileSizeMbRaw <= 0) return res.status(400).json({ message: '单人大小限制不正确' })
      const descriptionRaw = textInput(source.description ?? '', '收集说明', COLLECTION_DESCRIPTION_MAX, {optional:true,multiline:true})
      if (descriptionRaw.length > COLLECTION_DESCRIPTION_MAX) return res.status(400).json({ message: `收集说明不能超过 ${COLLECTION_DESCRIPTION_MAX} 个字` })
      const description = descriptionRaw || '请上传你负责的文件'
      const deadline = normalizeExpiryInput(source.deadline === undefined ? new Date(Date.now() + 7 * 86400000).toISOString() : source.deadline, '截止时间')
      if (!deadline) return res.status(400).json({ message: '截止时间格式不正确' })
      const allowedTypes = source.allowedTypes === undefined ? ['全部格式'] : collectionTypesInput(source.allowedTypes)
      const materials = normalizeCollectionMaterials(source.materials)
      const customFields = normalizeCollectionCustomFields(source.customFields)
      const maxFileSizeMb = Math.floor(maxFileSizeMbRaw)
      const creationSignature = creationKey ? createHash('sha256').update(JSON.stringify({ title, description, deadline: source.deadline === undefined ? 'default' : deadline, allowedTypes, materials, customFields, maxFileSizeMb })).digest('hex') : ''
      const findIdempotentCollection = () => creationKey && metadata.collections.find(item => item.creationKey === creationKey && (
        ownerSession?.user?.id ? item.ownerUserId === ownerSession.user.id : item.ownerGuestKey === ownerGuestKey
      ))
      const replayExisting = () => {
        const existing = findIdempotentCollection()
        if (!existing) return false
        if (existing.creationSignature !== creationSignature) {
          res.status(409).json({ code: 'idempotency_key_reused', message: '此创建请求标识已用于其他内容，请重新提交' })
          return true
        }
        res.status(200).json({ collection: publicCollection(existing, req, true), manageToken: existing.manageToken })
        return true
      }
      if (replayExisting()) return
      if (new Date(deadline).getTime() <= Date.now()) return res.status(400).json({ message: '截止时间必须晚于当前时间' })
      assertActiveCollectionLimit(ownerSession?.user?.id, ownerGuestKey)
      const token = creationId || createToken(10)
      const manageToken = createToken(18)
      const task = {
        id: token,
        token,
        manageToken,
        title,
        description,
        deadline,
        allowedTypes,
        materials,
        customFields,
        maxFileSizeMb,
        capacityBytes: ownerSession?.user?.id ? null : guestQuotaLimitBytes() || 1024 * 1024 * 1024,
        createdAt: new Date().toISOString(),
        ownerUserId: ownerSession?.user?.id || '',
        ...(creationKey ? { creationKey, creationSignature } : {}),
        brandingOrganizationId: enterpriseOrganizationForUser(ownerSession?.user?.id)?.id || '',
        ownerGuestKey,
        status: 'active',
        submissions: [],
      }
      task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${token}`, { width: 180, margin: 1 })
      // A concurrent retry may have passed the first lookup while QR generation was pending.
      // Recheck immediately before the synchronous metadata insert to keep one task per key.
      if (replayExisting()) return
      assertActiveCollectionLimit(task.ownerUserId, ownerGuestKey)
      metadata.collections.push(task)
      persistMetadata()
      await flushMetadataWrites()
      res.status(201).json({ collection: publicCollection(task, req, true), manageToken })
    } catch (error) {
      next(error)
    } finally { releaseCreation() }
  })
  app.get('/api/collections/:token', async (req, res, next) => {
    try {
      const task = metadata.collections.find((item) => item.token === req.params.token)
      if (!task) return res.status(404).json({ message: '收集任务不存在' })
      if (!validateEnterpriseSlug(task, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
      const access = validateCollection(task)
      if (!access.ok) {
        const payload = { message: access.message, code: access.code || '' }
        // 410 附带脱敏元信息，公开提交页据此渲染「收集已截止」页，而不是一句通用错误。
        if (access.status === 410) Object.assign(payload, { code: 'collection_closed', collection: collectionClosedMeta(task) })
        return res.status(access.status).json(payload)
      }
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
      const submitter = resolveCollectionSubmitter(req, res)
      assertCollectionParticipant(task, submitter)
      const participantName = submitter.participantName
      if (!participantName) {
        cleanupUploadedFiles(req.files)
        return res.status(400).json({ message: '请先登录，或填写提交人名称' })
      }
      const uploadedFiles = req.files || []
      if (!uploadedFiles.length) {
        return res.status(400).json({ message: '至少选择一个文件' })
      }
      const submissionData = validateCollectionSubmissionInput(task, req.body.fieldValues, req.body.materialIds, req.body.fileMaterialIds, uploadedFiles.length)
      const relativePaths = relativePathsInput(req.body.relativePaths, uploadedFiles)
      uniqueFilePaths(uploadedFiles.map((file,index) => ({ relativePath:relativePaths[index] })))
      assertConfiguredUploadLimits(req, uploadedFiles)
      const guestKey = assertGuestQuota(req, res, uploadedFiles)
      assertCollectionFiles(task, uploadedFiles)
      reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, collectionToken: task.token, uploadUserId: submitter.submitterUserId || '', participantKey: submitter.participantKey, submitterUserId: submitter.submitterUserId, capacityOwnerUserId: task.ownerUserId }, req.directUploadReservationId)
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
      const submission = await publishCollectionSubmission(task, files, { ...submitter, ...submissionData }, req, { guestKey, overwriteExisting: req.body.overwriteExisting === true || req.body.overwriteExisting === 'true' })
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
      for (const submission of task.submissions || []) removeStoredFiles(submission.files || [], path.join(collectionsRoot, task.id, submission.id), userFilesRoot)
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
      removeStoredFiles(submission.files || [], path.join(collectionsRoot, task.id, submission.id), userFilesRoot)
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
      sendDownloadFile(req, res, next, storedCollectionFilePath(task, submission, file), file)
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
      sendPreviewFile(req, res, next, storedCollectionFilePath(task, submission, file), file)
    } catch (error) {
      next(error)
    }
  })
}
