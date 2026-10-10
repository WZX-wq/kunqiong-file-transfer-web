// upload 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_FILE_SIZE, collectionsRoot, tempRoot
} from '../config.js'
import {
  createToken, httpError, removeDirectory
} from '../lib/http.js'
import {
  normalizeSystemConfig
} from '../lib/metadata-normalizers.js'
import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'
import {
  chunkUpload, normalizeUploadFileName
} from '../lib/upload.js'
import {
  accountOrganizationForUser, accountUserById, authSessionFromRequest, safeRelativePath
} from '../services/account.js'
import {
  addCollectionSubmissionMessage, addGuestUsage, assertAccountCapacity, assertCollectionFiles,
  assertConfiguredUploadLimits, assertGuestQuota, assertSafeUploadFiles, assertServiceWritable,
  assertTeamCapacity, assertUniqueTeamResourceNames, assertUploadCapacity,
  cleanupUploadedFiles, createShareFromTempFiles, discardUploadSession, isAllowedType, normalizeUploadChunkSize,
  persistUploadSession, publicShare, publicSubmission, readShareOptions,
  requireUploadSessionOwner, resolveCollectionSubmitter, uploadSessionSignature, validateCollection
} from '../services/shares.js'
import {
  uploadSessions
} from '../state.js'

export function registerUploadRoutes(app) {
  app.post('/api/upload-sessions', (req, res) => {
  assertServiceWritable(req)
  const files = Array.isArray(req.body.files) ? req.body.files : []
  if (!files.length) return res.status(400).json({ message: '至少选择一个文件' })
  const config = normalizeSystemConfig(metadata.systemConfig)
  if (files.length > config.maxBatchFiles) return res.status(413).json({ message: `单次最多上传 ${config.maxBatchFiles} 个文件` })

  const normalizedFiles = files.map((file, index) => ({
    name: normalizeUploadFileName(file.name || `文件 ${index + 1}`),
    relativePath: safeRelativePath(normalizeUploadFileName(file.relativePath || file.name || `文件 ${index + 1}`)),
    size: Number(file.size || 0),
    mimeType: String(file.mimeType || 'application/octet-stream'),
    chunks: new Set(),
  }))
  if (normalizedFiles.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) return res.status(400).json({ message: '文件大小必须为有效的非负整数' })
  const invalid = normalizedFiles.find((file) => file.size > MAX_FILE_SIZE)
  if (invalid) return res.status(413).json({ message: `${invalid.name} 超过 5 GB 限制` })
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
    collectionSubmitter = resolveCollectionSubmitter(req)
    if (!collectionSubmitter.participantName) return res.status(400).json({ message: '请先登录，或填写提交人名称' })
    const invalidCollectionFile = normalizedFiles.find((file) => file.size > collectionTask.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.name, collectionTask.allowedTypes))
    if (invalidCollectionFile) return res.status(413).json({ message: `${invalidCollectionFile.name} 不符合当前收集任务的文件限制` })
  }
  if (req.body.mode === 'team_resource') {
    if (!ownerSession?.user?.id) return res.status(401).json({ message: '请先登录后上传到团队空间' })
    teamOrganization = accountOrganizationForUser(ownerSession.user.id)
    if (!teamOrganization) return res.status(404).json({ message: '你尚未加入团队空间' })
    if (!teamOrganization.members.some((member) => member.userId === ownerSession.user.id && member.status === 'active')) {
      return res.status(403).json({ message: '当前成员状态不能上传到团队空间' })
    }
    assertUniqueTeamResourceNames(teamOrganization, normalizedFiles)
    assertTeamCapacity(teamOrganization, normalizedFiles.reduce((sum, file) => sum + file.size, 0))
  } else {
    assertAccountCapacity(collectionTask ? accountUserById(collectionTask.ownerUserId) : ownerSession?.user, normalizedFiles.reduce((sum, file) => sum + file.size, 0))
  }

  const sessionId = createToken(18)
  const sessionDirectory = path.join(tempRoot, 'upload-sessions', sessionId)
  fs.mkdirSync(sessionDirectory, { recursive: true })
  const isTeamResourceSession = req.body.mode === 'team_resource'
  const session = {
    id: sessionId,
    chunkSize: normalizeUploadChunkSize(req.body.chunkSize),
    files: normalizedFiles,
    // 游客计账 key 冻结在会话上：complete 成功时按它补记累计用量（登录用户为空串）。
    guestKey,
    ownerUserId: ownerSession?.user?.id || '',
    capacityOwnerUserId: collectionTask ? collectionTask.ownerUserId : ownerSession?.user?.id || '',
    // 团队资源走团队空间权益，不校验上传者的个人 permanent。
    options: readShareOptions(req.body, ownerSession?.user, isTeamResourceSession),
    mode: isTeamResourceSession ? 'team_resource' : (req.body.mode === 'collection' ? 'collection' : 'share'),
    organizationId: teamOrganization?.id || '',
    collectionToken: collectionTask?.token || '',
    participantName: collectionSubmitter ? collectionSubmitter.participantName : String(req.body.participantName || '').trim().slice(0, 40),
    submitterUserId: collectionSubmitter?.submitterUserId || '',
    submitterName: collectionSubmitter?.submitterName || '',
    relativePaths: Array.isArray(req.body.relativePaths) ? req.body.relativePaths : [],
    directory: sessionDirectory,
    createdAt: new Date().toISOString(),
  }
  // 同一游客重新上传相同文件清单 = 对旧会话的放弃重试：直接替换并释放旧预留。
  // 否则失败/放弃的旧会话会以「进行中占用」挡住重试，且对用户不可见。
  if (session.guestKey) {
    const signature = uploadSessionSignature(session.files)
    for (const [otherId, other] of [...uploadSessions]) {
      if (otherId !== sessionId && other.guestKey === session.guestKey && other.mode === session.mode && uploadSessionSignature(other.files) === signature) {
        discardUploadSession(other)
      }
    }
  }
  assertUploadCapacity(session)
  uploadSessions.set(sessionId, session)
  persistUploadSession(session)
  res.status(201).json({ sessionId, uploaded: session.files.map((file) => ({ name: file.name, chunks: [] })) })
})
  app.post('/api/upload-sessions/:sessionId/chunks', requireUploadSessionOwner, chunkUpload.single('chunk'), async (req, res, next) => {
  try {
    const session = req.uploadSession
    const fileIndex = Number(req.body.fileIndex)
    const chunkIndex = Number(req.body.chunkIndex)
    const totalChunks = Number(req.body.totalChunks)
    if (!Number.isInteger(fileIndex) || !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || fileIndex < 0 || fileIndex >= session.files.length || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片参数不完整' })
    }
    const file = session.files[fileIndex]
    if (!file || !req.file) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片文件不存在' })
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
  }
})
  app.get('/api/upload-sessions/:sessionId', requireUploadSessionOwner, (req, res) => {
  const session = req.uploadSession
  res.json({
    sessionId: session.id,
    chunkSize: session.chunkSize,
    createdAt: session.createdAt,
    files: session.files.map((file, fileIndex) => ({
      name: file.name,
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
  discardUploadSession(req.uploadSession)
  res.status(204).end()
})
  app.post('/api/upload-sessions/:sessionId/complete', requireUploadSessionOwner, async (req, res, next) => {
  let activeSession
  try {
    const session = req.uploadSession
    if (session.completing) return res.status(409).json({ message: '此上传正在发布，请稍后重试' })
    activeSession = session
    session.completing = true
    assertUploadCapacity(session, session.id)
    // 分片直写模式：这里只做完整性校验（逐 index 齐片 + 目标文件大小），
    // 不再合并 —— 旧版同步合并 5GB 文件会阻塞事件循环 10~35 秒。
    for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
      const file = session.files[fileIndex]
      const expectedChunks = Math.max(1, Math.ceil(file.size / session.chunkSize))
      const hasAllChunks = file.chunks.size === expectedChunks && Array.from({ length: expectedChunks }, (_, index) => index).every((index) => file.chunks.has(index))
      if (!hasAllChunks) {
        return res.status(409).json({ message: `${file.name} 还有分片未上传完成` })
      }
    }

    const mergedFiles = session.files.map((file, fileIndex) => {
      const targetPath = path.join(session.directory, `${fileIndex}.target`)
      if (!fs.existsSync(targetPath)) throw httpError(400, `${file.name} 分片缺失，请重试上传`)
      if (fs.statSync(targetPath).size !== file.size) {
        throw httpError(400, `${file.name} 文件大小校验失败，请重新上传`)
      }
      return {
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
        tempPath: targetPath,
      }
    })
    await assertSafeUploadFiles(mergedFiles)
    if (session.mode === 'collection') {
      const task = metadata.collections.find((item) => item.token === session.collectionToken)
      if (!task) return res.status(404).json({ message: '收集任务不存在' })
      const access = validateCollection(task)
      if (!access.ok) return res.status(access.status).json({ message: access.message })
      assertCollectionFiles(task, mergedFiles)
      assertUploadCapacity(session, session.id)
      const participantName = session.participantName.trim()
      const files = mergedFiles.map((file, index) => {
        const relativePath = safeRelativePath(session.relativePaths[index] || file.relativePath || file.name)
        const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
        return { ...file, relativePath, storedName }
      })
      const submissionId = createToken(12)
      const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
      fs.mkdirSync(submissionDirectory, { recursive: true })
      const submissionFiles = files.map((file) => {
        fs.renameSync(file.tempPath, path.join(submissionDirectory, file.storedName))
        return { name: file.name, relativePath: file.relativePath, storedName: file.storedName, size: file.size, mimeType: file.mimeType, reviewStatus: file.reviewStatus, scanEngine: file.scanEngine, scannedAt: file.scannedAt }
      })
      const submission = {
        id: submissionId,
        participantName,
        submitterUserId: session.submitterUserId || '',
        submitterName: session.submitterName || participantName,
        submittedAt: new Date().toISOString(),
        files: submissionFiles,
      }
      task.submissions.push(submission)
      addCollectionSubmissionMessage(task, submission, req)
      addGuestUsage(session.guestKey, submissionFiles)
      persistMetadata()
      uploadSessions.delete(session.id)
      removeDirectory(session.directory)
      return res.status(201).json({ submission: publicSubmission(submission) })
    }
    if (session.mode === 'team_resource') {
      const organization = Object.values(metadata.organizations || {}).find((item) => item.id === session.organizationId)
      if (!organization) return res.status(404).json({ message: '团队空间不存在' })
      assertUniqueTeamResourceNames(organization, mergedFiles)
      assertTeamCapacity(organization, mergedFiles.reduce((sum, file) => sum + file.size, 0))
    }
    const share = await createShareFromTempFiles(mergedFiles, {
      ...session.options,
      teamResource: session.mode === 'team_resource',
      teamOrganizationId: session.organizationId,
    }, req)
    addGuestUsage(session.guestKey, mergedFiles)
    uploadSessions.delete(session.id)
    removeDirectory(session.directory)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  } finally {
    if (activeSession) activeSession.completing = false
  }
})
}
