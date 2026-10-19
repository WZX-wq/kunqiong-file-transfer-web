import { assertCollectionParticipant } from '../services/entitlements.js'
// upload 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  GUEST_ID_COOKIE, MAX_FILE_SIZE, tempRoot
} from '../config.js'
import {
  createToken, httpError, removeDirectory
} from '../lib/http.js'
import {
  normalizeSystemConfig
} from '../lib/metadata-normalizers.js'
import {
  metadata
} from '../lib/metadata-store.js'
import {
  chunkUpload, prepareChunkUpload
} from '../lib/upload.js'
import {
  accountOrganizationForUser, accountOrganizationPlanForUser, accountUserById, authSessionFromRequest, readCookie
} from '../services/account.js'
import {
  addGuestUsage, assertAccountCapacity, assertCollectionFiles,
  assertConfiguredUploadLimits, assertGuestQuota, assertSafeUploadFiles, assertServiceWritable,
  assertTeamCapacity, assertUniqueTeamResourceNames, assertUploadCapacity,
  cleanupUploadedFiles, createShareFromTempFiles, discardUploadSession, isAllowedType, normalizeUploadChunkSize,
  issueGuestCookie, validGuestId, persistUploadSession, publicShare, publicSubmission, publishCollectionSubmission, readShareOptions,
  requireUploadSessionOwner, assertUploadSessionOwner, publicUploadCompletion, uploadCompletionResult,
  releaseUploadDiskReservation, reserveUploadDisk, resolveCollectionSubmitter, uploadSessionSignature, validateCollection
} from '../services/shares.js'
import {
  uploadSessions
} from '../state.js'
import { fileMetadataInput, relativePathsInput, uniqueFilePaths } from '../lib/file-input.js'
import { integerInput, textInput } from '../lib/input-validation.js'

export function registerUploadRoutes(app) {
  app.post('/api/upload-sessions', (req, res) => {
  assertServiceWritable(req)
  const files = Array.isArray(req.body.files) ? req.body.files : []
  if (!files.length) return res.status(400).json({ message: '至少选择一个文件' })
  const config = normalizeSystemConfig(metadata.systemConfig)
  if (files.length > config.maxBatchFiles) return res.status(413).json({ message: `单次最多上传 ${config.maxBatchFiles} 个文件` })

  if (req.body.mode !== undefined && !['share','collection','team_resource'].includes(req.body.mode)) throw httpError(400,'上传模式不支持')
  const normalizedFiles = files.map(file => ({ ...fileMetadataInput(file), chunks:new Set() }))
  const paths = relativePathsInput(req.body.relativePaths, normalizedFiles)
  normalizedFiles.forEach((file,index) => { file.relativePath = paths[index] })
  uniqueFilePaths(normalizedFiles)
  if (normalizedFiles.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) return res.status(400).json({ message: '文件大小必须为有效的非负整数' })
  const invalid = normalizedFiles.find((file) => file.size > MAX_FILE_SIZE)
  if (invalid) return res.status(413).json({ message: `${invalid.name} 超过 20 GB 系统上限` })
  assertConfiguredUploadLimits(req, normalizedFiles)
  const guestKey = assertGuestQuota(req, res, normalizedFiles)
  const ownerSession = authSessionFromRequest(req)
  let collectionTask = null
  let teamOrganization = null
  let collectionSubmitter = null
  if (req.body.mode === 'collection') {
    collectionTask = metadata.collections.find((item) => item.token === String(req.body.collectionToken || ''))
    if (!collectionTask) return res.status(404).json({ message: '收集任务不存在' })
    const access = validateCollection(collectionTask)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    collectionSubmitter = resolveCollectionSubmitter(req, res)
    assertCollectionParticipant(collectionTask, collectionSubmitter)
    if (!collectionSubmitter.participantName) return res.status(400).json({ message: '请先登录，或填写提交人名称' })
    const invalidCollectionFile = normalizedFiles.find((file) => file.size > collectionTask.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.name, collectionTask.allowedTypes))
    if (invalidCollectionFile) return res.status(413).json({ message: `${invalidCollectionFile.name} 不符合当前收集任务的文件限制` })
  }
  if (req.body.mode === 'team_resource') {
    if (!ownerSession?.user?.id) return res.status(401).json({ message: '请先登录后上传到团队空间' })
    teamOrganization = accountOrganizationForUser(ownerSession.user.id)
    if (!teamOrganization) return res.status(404).json({ message: '你尚未加入团队空间' })
    if (!accountOrganizationPlanForUser(ownerSession.user.id, teamOrganization).team) return res.status(403).json({ message: '管理员已调整当前套餐，请购买团队套餐后使用团队功能' })
    if (!teamOrganization.members.some((member) => member.userId === ownerSession.user.id && member.status === 'active')) {
      return res.status(403).json({ message: '当前成员状态不能上传到团队空间' })
    }
    assertUniqueTeamResourceNames(teamOrganization, normalizedFiles)
    assertTeamCapacity(teamOrganization, normalizedFiles.reduce((sum, file) => sum + file.size, 0), ownerSession.user.id)
  } else {
    assertAccountCapacity(collectionTask ? accountUserById(collectionTask.ownerUserId) : ownerSession?.user, normalizedFiles.reduce((sum, file) => sum + file.size, 0))
  }

  const isTeamResourceSession = req.body.mode === 'team_resource'
  const options = readShareOptions(req.body, ownerSession?.user, isTeamResourceSession)
  if (req.body.chunkSize !== undefined) integerInput(req.body.chunkSize, '分片大小', 1, Number.MAX_SAFE_INTEGER, {string:false})
  const sessionId = createToken(18)
  const sessionDirectory = path.join(tempRoot, 'upload-sessions', sessionId)
  let ownerGuestId = ''
  if (collectionTask && !ownerSession?.user?.id) {
    const existing = readCookie(req, GUEST_ID_COOKIE)
    // Quota validation may already have issued the cookie on this first request.
    const issued = [].concat(res.getHeader('Set-Cookie') || []).findLast((cookie) => cookie.startsWith(`${GUEST_ID_COOKIE}=`))?.split(';')[0].slice(GUEST_ID_COOKIE.length + 1)
    ownerGuestId = validGuestId(existing) ? existing : issued || issueGuestCookie(req, res)
  }
  const session = {
    id: sessionId,
    chunkSize: normalizeUploadChunkSize(req.body.chunkSize),
    files: normalizedFiles,
    // 游客计账 key 冻结在会话上：complete 成功时按它补记累计用量（登录用户为空串）。
    guestKey,
    ownerUserId: ownerSession?.user?.id || '',
    ownerGuestId,
    capacityOwnerUserId: collectionTask ? collectionTask.ownerUserId : ownerSession?.user?.id || '',
    // 团队资源走团队空间权益，不校验上传者的个人 permanent。
    options,
    mode: isTeamResourceSession ? 'team_resource' : (req.body.mode === 'collection' ? 'collection' : 'share'),
    organizationId: teamOrganization?.id || '',
    collectionToken: collectionTask?.token || '',
    participantName: collectionSubmitter ? collectionSubmitter.participantName : String(req.body.participantName || '').trim().slice(0, 40),
    participantKey: collectionSubmitter?.participantKey || '',
    submitterUserId: collectionSubmitter?.submitterUserId || '',
    submitterName: collectionSubmitter?.submitterName || '',
    relativePaths: paths,
    directory: sessionDirectory,
    createdAt: new Date().toISOString(),
  }
  // 同一游客重新上传相同文件清单 = 对旧会话的放弃重试：直接替换并释放旧预留。
  // 否则失败/放弃的旧会话会以「进行中占用」挡住重试，且对用户不可见。
  if (session.guestKey && session.ownerGuestId) {
    const signature = uploadSessionSignature(session.files)
    for (const [otherId, other] of [...uploadSessions]) {
      if (otherId !== sessionId && other.ownerGuestId === session.ownerGuestId && other.guestKey === session.guestKey && other.mode === session.mode && other.collectionToken === session.collectionToken && uploadSessionSignature(other.files) === signature) {
        if (other.completing) throw httpError(409, '相同文件正在进行安全检查，请等待原上传的结果')
        if (other.completion?.status !== 'complete') discardUploadSession(other)
      }
    }
  }
  assertUploadCapacity(session)
  reserveUploadDisk(session)
  fs.mkdirSync(sessionDirectory, { recursive: true })
  uploadSessions.set(sessionId, session)
  persistUploadSession(session)
  res.status(201).json({ sessionId, chunkSize:session.chunkSize, uploaded: session.files.map((file) => ({ name: file.name, chunks: [] })) })
})
  app.post('/api/upload-sessions/:sessionId/chunks', requireUploadSessionOwner, prepareChunkUpload, chunkUpload.single('chunk'), async (req, res, next) => {
  let writing = false
  try {
    const session = req.uploadSession
    if (uploadSessions.get(session.id) !== session) throw httpError(410, '上传会话已取消，请重新开始上传')
    if (session.completing || session.completion) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      throw httpError(409, '文件已进入安全检查，不能再修改分片')
    }
    session.activeWrites = (session.activeWrites || 0) + 1
    writing = true
    const fileIndex = integerInput(req.body.fileIndex,'文件索引',0,session.files.length-1)
    const chunkIndex = integerInput(req.body.chunkIndex,'分片索引',0,Number.MAX_SAFE_INTEGER)
    const totalChunks = integerInput(req.body.totalChunks,'分片总数',1,Number.MAX_SAFE_INTEGER)
    if (!Number.isInteger(fileIndex) || !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || fileIndex < 0 || fileIndex >= session.files.length || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片参数不完整' })
    }
    const file = session.files[fileIndex]
    if (!file || !req.file) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片文件不存在' })
    }
    const expectedChunks = Math.max(1, Math.ceil(file.size / session.chunkSize))
    if (totalChunks !== expectedChunks || chunkIndex >= expectedChunks) {
      cleanupUploadedFiles([req.file])
      return res.status(400).json({ message: '分片位置或总数与上传会话配置不一致' })
    }
    if (file.totalChunks && file.totalChunks !== totalChunks) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(409).json({ message: '分片总数发生变化，请重新开始上传' })
    }
    // 分片位置与会话配置强校验：offset 只能由 chunkIndex*chunkSize 推出，
    // 大小必须是 min(chunkSize, 文件剩余)。旧客户端不带 chunkSize 时按默认 8MB 兼容。
    const expectedOffset = chunkIndex * session.chunkSize
    const expectedSize = Math.min(session.chunkSize, Math.max(0, file.size - expectedOffset))
    if ((file.size > 0 && expectedOffset >= file.size) || req.file.size !== expectedSize) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片大小与上传会话配置不一致，请重新开始上传' })
    }
    // 内容校验：客户端带 SHA-256 时必须匹配，防止静默损坏/串片。
    const chunkBuffer = await fs.promises.readFile(req.file.path)
    if (req.body.chunkHash) {
      const actualHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex')
      if (actualHash !== String(req.body.chunkHash).toLowerCase()) {
        cleanupUploadedFiles(req.file ? [req.file] : [])
        return res.status(400).json({ message: '分片校验失败，将自动重试' })
      }
    }
    // 分片直写：按 offset 定位写入目标文件（pwrite，乱序到达也安全），complete 阶段零合并。
    const targetPath = path.join(session.directory, `${fileIndex}.target`)
    const target = await fs.promises.open(targetPath, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644)
    try {
      await target.write(chunkBuffer, 0, chunkBuffer.length, expectedOffset)
    } finally {
      await target.close()
    }
    await fs.promises.unlink(req.file.path).catch(() => {})
    const markerDirectory = path.join(session.directory, String(fileIndex))
    fs.mkdirSync(markerDirectory, { recursive: true })
    fs.writeFileSync(path.join(markerDirectory, `${chunkIndex}.done`), '')
    file.totalChunks = totalChunks
    file.chunks.add(chunkIndex)
    res.json({ ok: true, fileIndex, chunkIndex, uploadedChunks: file.chunks.size })
  } catch (error) {
    cleanupUploadedFiles(req.file ? [req.file] : [])
    next(error)
  } finally {
    if (writing) req.uploadSession.activeWrites = Math.max(0, (req.uploadSession.activeWrites || 0) - 1)
    if (req.uploadSession.cancelled && !req.uploadSession.activeWrites) discardUploadSession(req.uploadSession)
  }
})
  app.get('/api/upload-sessions/:sessionId', requireUploadSessionOwner, (req, res) => {
  const session = req.uploadSession
  res.json({
    sessionId: session.id,
    chunkSize: session.chunkSize,
    createdAt: session.createdAt,
    completion: publicUploadCompletion(session, req),
    files: session.files.map((file, fileIndex) => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      totalChunks: Math.max(1, Math.ceil(file.size / session.chunkSize)),
      uploadedChunks: Array.from(file.chunks).sort((a, b) => a - b),
      targetReady: fs.existsSync(path.join(session.directory, `${fileIndex}.target`)),
    })),
  })
})
  // 主动中止上传会话：客户端放弃/重开上传时调用，立即释放其预留额度，
  // 避免僵尸会话（中途失败后不再续传的会话）把游客配额占满到 TTL 过期。
  app.delete('/api/upload-sessions/:sessionId', requireUploadSessionOwner, (req, res) => {
  if (req.uploadSession.completing) throw httpError(409, '文件正在处理，请等待处理结束后再操作')
  discardUploadSession(req.uploadSession)
  res.status(204).end()
})
  app.post('/api/upload-sessions/:sessionId/complete', requireUploadSessionOwner, async (req, res, next) => {
  const session = req.uploadSession
  const background = req.body.background === true
  try {
    if (session.completion) {
      const retryable = session.completion.status === 'failed' && (['scan_timeout', 'scan_unavailable', 'scan_incomplete', 'scan_size_limit', 'scan_interrupted'].includes(session.completion.error?.code) || [503, 502, 504].includes(session.completion.error?.status))
      if (!(req.body.retry === true && retryable)) return res.json({ completion: publicUploadCompletion(session, req) })
    }
    if (session.completing) return res.status(409).json({ message: '此上传正在发布，请稍后重试' })
    if (session.activeWrites) throw httpError(409, '分片仍在写入，请稍后重试')
    const mergedFiles = prepareUpload(req, session)
    session.completing = true
    if (background) {
      session.completion = { status: 'scanning', startedAt: new Date().toISOString(), currentFile: '', fileIndex: 0, fileCount: session.files.length }
      persistUploadSession(session)
      // Detach the lengthy scanner request from the browser's HTTP connection.
      // Repeated starts attach to the same job; GET only reports its state.
      void completeUpload(req, session, mergedFiles).then(() => {
        releaseUploadDiskReservation(session)
        session.completion = { ...session.completion, status: 'complete', finishedAt: new Date().toISOString() }
      }).catch(error => {
        // Metadata may already have committed before notification delivery failed.
        if (!error.publicationUncertain && uploadCompletionResult(session, req)) {
          releaseUploadDiskReservation(session)
          session.completion = { ...session.completion, status: 'complete', finishedAt: new Date().toISOString() }
        } else {
          const status = error.status || 500
          session.completion = { ...session.completion, status: 'failed', finishedAt: new Date().toISOString(), error: {
            status, message: error.status ? error.message : '文件处理失败，请稍后重试', code: error.code || 'upload_completion_failed',
            ...(error.scanLimit ? { scanLimit: error.scanLimit } : {}), ...(error.guestQuota ? { guestQuota: error.guestQuota } : {}),
            ...(error.scanFile ? { scanFile: error.scanFile } : {}), ...(error.scanFinding ? { scanFinding: error.scanFinding } : {}),
          } }
          console.error(JSON.stringify({ event: 'upload_completion_failed', code: session.completion.error.code }))
        }
      }).finally(() => {
        session.completing = false
        persistUploadSession(session)
      })
      return res.status(202).json({ completion: publicUploadCompletion(session, req) })
    }
    try {
      const result = await completeUpload(req, session, mergedFiles)
      releaseUploadDiskReservation(session)
      uploadSessions.delete(session.id)
      removeDirectory(session.directory)
      res.status(201).json(result)
    } finally { session.completing = false }
  } catch (error) { next(error) }
})
}

function prepareUpload(req, session) {
  // 恢复的会话也必须经过当前写入校验，不能把旧清单直接当成可信文件元数据。
  if (!['share','collection','team_resource'].includes(session.mode) || !Array.isArray(session.files) || !session.files.length) throw httpError(400, '上传会话格式不正确，请重新上传')
  integerInput(session.chunkSize, '分片大小', 1048576, 16777216, {string:false})
  const checkedFiles = session.files.map(fileMetadataInput)
  const checkedPaths = relativePathsInput(session.relativePaths, checkedFiles)
  checkedFiles.forEach((file,index) => { file.relativePath = checkedPaths[index] })
  uniqueFilePaths(checkedFiles)
  assertConfiguredUploadLimits(req, checkedFiles, session)
  assertUploadCapacity(session, session.id)
  // 分片直写模式：这里只做完整性校验（逐 index 齐片 + 目标文件大小），
  // 不再合并 —— 旧版同步合并 5GB 文件会阻塞事件循环 10~35 秒。
  for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
    const file = session.files[fileIndex]
    const expectedChunks = Math.max(1, Math.ceil(file.size / session.chunkSize))
    const hasAllChunks = file.chunks.size === expectedChunks && Array.from({ length: expectedChunks }, (_, index) => index).every((index) => file.chunks.has(index))
    if (!hasAllChunks) {
      throw httpError(409, `${file.name} 还有分片未上传完成`)
    }
  }

  return session.files.map((file, fileIndex) => {
    const targetPath = path.join(session.directory, `${fileIndex}.target`)
    if (!fs.existsSync(targetPath)) throw httpError(400, `${file.name} 分片缺失，请重试上传`)
    if (fs.statSync(targetPath).size !== file.size) {
      throw httpError(400, `${file.name} 文件大小校验失败，请重新上传`)
    }
    return {
      ...checkedFiles[fileIndex],
      tempPath: targetPath,
    }
  })
}

async function completeUpload(req, session, mergedFiles) {
  await assertSafeUploadFiles(mergedFiles, (file, index, progress) => {
    if (session.completion) session.completion = { ...session.completion, ...progress, currentFile: file?.name || '', fileIndex: file ? index + 1 : 0 }
  })
  assertUploadSessionOwner(session, req)
  assertUploadCapacity(session, session.id)
  assertServiceWritable(req)
  if (session.completion) {
    session.completion = { ...session.completion, status: 'publishing', currentFile: '' }
    persistUploadSession(session)
  }
  if (session.mode === 'collection') {
    const task = metadata.collections.find((item) => item.token === session.collectionToken)
    if (!task) throw httpError(404, '收集任务不存在')
    const access = validateCollection(task)
    if (!access.ok) throw httpError(access.status, access.message)
    assertCollectionFiles(task, mergedFiles)
    assertUploadCapacity(session, session.id)
    const participantName = textInput(session.participantName, '提交人名称', 40)
    const submission = await publishCollectionSubmission(task, mergedFiles, { participantName, participantKey: session.participantKey, submitterUserId: session.submitterUserId, submitterName: session.submitterName }, req, { uploadSessionId: session.id, guestKey: session.guestKey })
    return { submission: publicSubmission(submission) }
  }
  if (session.mode === 'team_resource') {
    const organization = Object.values(metadata.organizations || {}).find((item) => item.id === session.organizationId)
    if (!organization) throw httpError(404, '团队空间不存在')
    assertUniqueTeamResourceNames(organization, mergedFiles)
    assertTeamCapacity(organization, mergedFiles.reduce((sum, file) => sum + file.size, 0), session.uploadUserId ?? session.ownerUserId)
  }
  const share = await createShareFromTempFiles(mergedFiles, {
    ...session.options,
    teamResource: session.mode === 'team_resource',
    teamOrganizationId: session.organizationId,
    uploadSessionId: session.id,
  }, req)
  addGuestUsage(session.guestKey, mergedFiles)
  return { share: publicShare(share, req, true, true) }
}
