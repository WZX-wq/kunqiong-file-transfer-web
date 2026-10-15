import React from 'react'
import { SecurityCheckStatus } from '../components/security-check-status.jsx'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, copyTextToClipboard, createShareFileDownloadConfig, createSubmissionFileDownloadConfig, createUploadSessionState } from '../lib/api.js'
import { ConfirmModal, FeedbackMessage, LoadingBlock, PublicShell, StateBlock } from '../components/common.jsx'
import { ArrowLeft, Building2, CalendarDays, Clock3, Download, Eye, FileText, FolderOpen, Inbox, KeyRound, Link2, Pause, Play, QrCode, RefreshCw, Settings2, Trash2, UploadCloud, UserRound, Users, X } from 'lucide-react'
import { CollectionLimitInfo, DownloadProgressPanel, FileFormatBadge, FilePreviewModal, FileRow, ManageItemModal, QrPreviewModal, TeamJoinRequestCard, UserAvatar, toFileItems } from '../components/ui.jsx'
import { useConfirmDialog, useDownloadTask } from '../hooks.js'
import { canReopenCollection, collectionFileAccept, collectionStatusText, createCollectionRecord, createShareRecord, isAllowedCollectionFile, saveAuthoritativeLocalRecord, savePublicRecord, shareStatusText } from '../lib/records.js'
import { canPreviewFile, clearUploadResume, copyImageToClipboard, createCollectionDownloadConfig, createShareDownloadConfig, createShareFilePreviewConfig, createSubmissionDownloadConfig, createSubmissionFilePreviewConfig, queryUploadResume, readCollectionUploadResume, uploadShareInChunks } from '../lib/transfer.js'
import { displayUserName, feedbackTone, formatBytes, formatDate, formatExpiry } from '../lib/format.js'
import { MAX_FILES } from '../lib/constants.js'
import { limitInputText } from '../lib/input-limits.js'

export function TeamInvitePage({ slug }) {
  // 落地页自己探一次团队是否存在：无效 slug 时上方导语必须换成「链接已失效」，
  // 否则页面会一边说「你收到一个团队空间邀请」、一边渲染不出任何可操作入口，自相矛盾。
  const [probe, setProbe] = useState(null)
  useEffect(() => {
    if (!slug) return undefined
    let active = true
    apiRequest(`/api/organizations/${encodeURIComponent(slug)}/join-request`)
      .then((result) => { if (active) setProbe(result) })
      .catch(() => { if (active) setProbe({ available: false, reason: 'unavailable' }) })
    return () => { active = false }
  }, [slug])
  const invalid = probe && probe.reason === 'unavailable'
  return (
    <PublicShell>
      <section className="team-invite-page">
        <div className="team-invite-hero">
          <span className="team-invite-hero-icon">{invalid ? <Building2 size={26} /> : <Users size={26} />}</span>
          <p className="eyebrow">团队空间邀请</p>
          <h1>{invalid ? '这个邀请链接已失效' : '你收到一个团队空间邀请'}</h1>
          <p>{invalid ? '该团队不存在或已解散，请联系邀请你的人重新获取链接。' : '登录鲲穹账号后即可申请加入，申请会提交给团队所有者审批。'}</p>
        </div>
        {!invalid && <TeamJoinRequestCard enterpriseSlug={slug} />}
      </section>
    </PublicShell>
  )
}

export function SharePage({ token, enterpriseSlug = '' }) {
  const [data, setData] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [requiresLogin, setRequiresLogin] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  useEffect(() => {
    const query = enterpriseSlug ? `?organization=${encodeURIComponent(enterpriseSlug)}` : ''
    apiRequest(`/api/shares/token/${token}${query}`).then((result) => {
      setData(result)
      savePublicRecord(createShareRecord(result.share, 'sent_to_me'))
    }).catch((err) => { setError(err.message); setRequiresLogin(err.code === 'directed_login_required') })
  }, [token, enterpriseSlug])
  const findShare = async () => {
    try {
      const result = await apiRequest(`/api/shares/lookup/${data.share.code}`, { method: 'POST', body: JSON.stringify({ password }) })
      setData(result)
      setActionError('')
      savePublicRecord(createShareRecord(result.share, 'sent_to_me'))
    } catch (err) { setActionError(err.message) }
  }
  if (error) return <PublicShell><StateBlock title="这个分享暂时不可用" detail={error} />{requiresLogin && <button className="primary-button" onClick={() => { window.location.href = `/api/auth/login?return_to=${encodeURIComponent(window.location.href)}` }}><UserRound size={16} /> 使用收件账号登录</button>}</PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const share = data.share
  const downloadAll = () => startDownload(createShareDownloadConfig(share, { password }))
  const downloadFile = (file, fileIndex) => startDownload(createShareFileDownloadConfig(share, file, fileIndex, { password }))
  const previewFile = (file, fileIndex) => setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex, { password }))
  return (
    <PublicShell>
      <div className="public-card share-public-card">
        <span className="public-icon"><Download size={24} /></span>
        <p className="eyebrow">鲲穹临时分享</p>
        <h1>有人给你发来了文件</h1>
        {data.requiresPassword && !share.files?.length ? (
          <>
            <p className="public-copy">此分享受提取密码保护，验证密码后即可查看文件内容。</p>
            <div className="public-password">
              <input maxLength={128} type="password" value={password} onChange={(event) => setPassword(limitInputText(event.target.value, 128))} placeholder="请输入提取密码，最多 128 个字符" />
              <button className="primary-button" onClick={findShare}><KeyRound size={15} /> 验证密码</button>
            </div>
            <small>{password.length}/128</small>
          </>
        ) : (
          <>
            <p className="public-copy">{share.files?.length || 0} 个文件 · {formatBytes((share.files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0))} · {formatExpiry(share.expiresAt)}</p>
            <div className="public-files">
              {(share.files || []).map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={downloadBusy} />)}
            </div>
            <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy || !(share.files || []).length}><Download size={17} /> {(share.files || []).length > 1 ? '下载全部文件' : '下载文件'}</button>
            <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
          </>
        )}
        {actionError && <FeedbackMessage message={actionError} tone="error" />}
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

export function ShareManagePage({ token }) {
  const [share, setShare] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const refreshShare = async () => {
    const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`)
    setShare(result.share)
    savePublicRecord(createShareRecord(result.share, 'my_sent'))
  }

  useEffect(() => {
    refreshShare().catch((err) => setError(err.message))
  }, [token])

  const saveShareSettings = async (payload) => {
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      setShare(result.share)
      savePublicRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const closeShare = async () => {
    const confirmed = await requestConfirm({
      title: '关闭分享链接',
      detail: '关闭后下载链接和取件码会立即失效。确定关闭这个分享吗？',
      confirmText: '关闭分享',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'DELETE' })
      setShare(result.share)
      savePublicRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const reopenShare = async (payload) => {
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...payload, status: 'active' }) })
      setShare(result.share)
      savePublicRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  if (error) return <PublicShell><StateBlock title="分享管理不可用" detail={error} /></PublicShell>
  if (!share) return <PublicShell><LoadingBlock /></PublicShell>

  const isActive = share.status === 'active'
  const fileCount = share.files?.length || 0
  const totalSize = share.files?.reduce((sum, file) => sum + Number(file.size || 0), 0) || 0
  const manageTarget = { kind: 'share', record: createShareRecord(share, 'my_sent'), data: share }
  const downloadFile = (file, fileIndex) => startDownload(createShareFileDownloadConfig(share, file, fileIndex))
  const previewFile = (file, fileIndex) => setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex))

  return (
    <PublicShell>
      <div className="public-card manage-card">
        <a className="secondary-button manage-back-link" href={share.enterpriseUrl ? '/team?tab=resources' : '/?view=records'}><ArrowLeft size={16} aria-hidden="true" />{share.enterpriseUrl ? '返回团队资源' : '返回收发记录'}</a>
        <p className="eyebrow">分享管理</p>
        <div className="manage-title-row">
          <h1>{share.files?.[0]?.name || '文件分享'}</h1>
          <div className="manage-title-actions">
            <button className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 编辑分享</button>
          </div>
        </div>
        <p className="public-copy">{fileCount ? `${fileCount} 个文件 · ${formatBytes(totalSize)} · 状态：${shareStatusText(share.status)}` : `文件已清理 · 状态：${shareStatusText(share.status)}`}</p>
        <div className="manage-list">
          {fileCount ? share.files.map((file) => (
            <div className="manage-submission" key={file.relativePath}>
              <div><strong>{file.name}</strong><span>{file.relativePath} · {formatBytes(file.size)}</span></div>
              <div className="manage-file-actions">{canPreviewFile(file) && <button className="ghost-icon" type="button" onClick={() => previewFile(file, share.files.indexOf(file))} disabled={!isActive} aria-label={`预览 ${file.name}`} title="预览文件"><Eye size={15} /></button>}<button className="ghost-icon" type="button" onClick={() => downloadFile(file, share.files.indexOf(file))} disabled={!isActive || downloadBusy} aria-label={`下载 ${file.name}`} title="下载文件"><Download size={15} /></button></div>
            </div>
          )) : (
            <div className="empty-manage"><FileText size={25} /><span>分享文件已关闭或清理</span></div>
          )}
        </div>
      </div>
      <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      {editing && <ManageItemModal target={manageTarget} onClose={() => setEditing(false)} onSave={saveShareSettings} onCloseTask={async () => { const closed = await closeShare(); if (closed) setEditing(false); return closed }} onReopenTask={async (payload) => { const reopened = await reopenShare(payload); if (reopened) setEditing(false); return reopened }} />}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
    </PublicShell>
  )
}

export function CollectionSubmitPage({ token, enterpriseSlug = '' }) {
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)
  const uploadRef = useRef(createUploadSessionState())
  const submitRunRef = useRef(0)
  const [collection, setCollection] = useState(null)
  const [files, setFiles] = useState([])
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [uploadPhase, setUploadPhase] = useState('idle')
  const [checkState, setCheckState] = useState({})
  const [completionPending, setCompletionPending] = useState(false)
  const [pendingUpload, setPendingUpload] = useState(null)
  const [message, setMessage] = useState('')
  // 登录后提交：提交者身份由账号决定，不需要也不能手填；
  // 未登录时保留手填入口（匿名提交仍然可用）。
  const signedIn = Boolean(user?.id)
  const resumeConfig = { resumeScope: `collection:${token}` }
  useEffect(() => {
    let active = true
    const restoreRun = submitRunRef.current
    const query = enterpriseSlug ? `?organization=${encodeURIComponent(enterpriseSlug)}` : ''
    apiRequest(`/api/collections/${token}${query}`).then((data) => {
      setCollection(data.collection)
      savePublicRecord(createCollectionRecord(data.collection, 'collect_from_me'))
    }).catch((err) => setMessage(err.message))
    apiRequest('/api/auth/me').then(({ user: current }) => {
      setUser(current || null)
      if (current) setName((existing) => existing.trim() ? existing : (current.nickname || current.username || ''))
    }).catch(() => {}).finally(() => setAuthChecked(true))
    const entry = readCollectionUploadResume(token)
    if (entry) {
      setPendingUpload(entry)
      setName(entry.participantName)
      setUploadPhase('paused')
      queryUploadResume(entry).then((restored) => {
        if (!active || submitRunRef.current !== restoreRun) return
        setPendingUpload(restored)
        setProgress(restored.progress)
        if (restored.completion?.status === 'failed') {
          const failure = restored.completion.error
          setUploadPhase(failure?.code === 'scan_threat_detected' ? 'blocked' : 'scan-failed')
          setMessage(failure?.message || '文件已上传，安全检查未完成，请重试安全检查')
        } else setMessage('已恢复上传进度，请重新选择原文件后继续上传')
      }).catch((err) => {
        if (!active || submitRunRef.current !== restoreRun) return
        if ([404, 410].includes(err.status)) {
          clearUploadResume({ resumeScope: `collection:${token}` }, entry.sessionId)
          setPendingUpload(null)
          setUploadPhase('idle')
        }
        setMessage(err.message)
      })
    }
    const pauseOnLeave = () => {
      uploadRef.current.paused = true
      uploadRef.current.abortCurrent?.()
    }
    window.addEventListener('pagehide', pauseOnLeave)
    return () => {
      active = false
      submitRunRef.current += 1
      pauseOnLeave()
      window.removeEventListener('pagehide', pauseOnLeave)
    }
  }, [token, enterpriseSlug])

  const startLogin = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const firstInvalidFile = (selectedFiles) => {
    const limitMb = Number(collection?.maxFileSizeMb || 0)
    return selectedFiles.find((file) => (
      (limitMb > 0 && file.size > limitMb * 1024 * 1024)
      || !isAllowedCollectionFile(file, collection?.allowedTypes)
    ))
  }

  const handleSelectFiles = (incoming) => {
    if (submitting || completionPending || !incoming?.length) return
    const selectedFiles = toFileItems(incoming).map((item) => ({
      ...item, id: JSON.stringify([item.relativePath, item.size, item.file.lastModified]),
    }))
    setFiles((current) => {
      const merged = new Map(current.map((item) => [item.id, item]))
      for (const item of selectedFiles) merged.set(item.id, item)
      return [...merged.values()]
    })
    if (pendingUpload?.completion?.status !== 'failed') setMessage('')
    if (!pendingUpload) setProgress(0)
  }

  const invalidFile = firstInvalidFile(files)
  const orderedFiles = pendingUpload ? pendingUpload.files.map((saved, index) => files.find((file) => file.name === saved.name && file.size === saved.size && file.relativePath === saved.relativePath && file.file.type === saved.mimeType && (!pendingUpload.fileLastModified || file.file.lastModified === pendingUpload.fileLastModified[index]))) : files
  const resumeMatches = !pendingUpload || (files.length === pendingUpload.files.length && orderedFiles.every(Boolean))
  const selectionError = files.length > MAX_FILES
    ? `单次最多提交 ${MAX_FILES} 个文件，当前已选 ${files.length} 个，请移除多余文件`
    : invalidFile ? `${invalidFile.name} 不符合当前收集任务的文件限制`
      : pendingUpload && files.length && !resumeMatches ? '请选择与上次上传一致且未修改的原文件，或放弃本次上传后重新提交' : ''
  const selectedBytes = files.reduce((sum, file) => sum + file.size, 0)

  const pauseSubmit = () => {
    if (uploadPhase === 'finalizing') return
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
    setUploadPhase('pausing')
    setMessage('正在暂停，保存已上传分片…')
  }

  const abandonUpload = async () => {
    if (submitting || completionPending) return
    submitRunRef.current += 1
    const entry = pendingUpload || readCollectionUploadResume(token)
    setSubmitting(true)
    try {
      if (entry?.sessionId) {
        await apiRequest(`/api/upload-sessions/${encodeURIComponent(entry.sessionId)}`, { method: 'DELETE' }).catch((err) => { if (![404, 410].includes(err.status)) throw err })
        clearUploadResume(resumeConfig, entry.sessionId)
      }
      uploadRef.current = createUploadSessionState()
      setPendingUpload(null)
      setFiles([])
      setProgress(0)
      setUploadPhase('idle')
      setMessage('已放弃本次上传，可以重新选择文件')
    } catch (err) { setMessage(err.message) }
    finally { setSubmitting(false) }
  }

  const removeSelectedFile = (fileId) => {
    if (submitting || completionPending) return
    setFiles((current) => current.filter((item) => item.id !== fileId))
    setMessage('')
    if (!pendingUpload) setProgress(0)
  }

  const submit = () => {
    if (submitting) return
    // 登录后提交者名取账号显示名，服务端也会以会话为准覆写，二者保持一致。
    const participantName = pendingUpload?.participantName || (signedIn ? (displayUserName(user) || name.trim()) : name.trim())
    if (!participantName || !files.length) {
      setMessage(signedIn ? '请选择要提交的文件' : '请填写提交人名称并选择文件')
      return
    }
    if (selectionError || !resumeMatches) {
      setMessage(selectionError)
      return
    }
    const submitRun = submitRunRef.current + 1
    submitRunRef.current = submitRun
    setSubmitting(true)
    setCompletionPending(false)
    setUploadPhase('uploading')
    setMessage('')
    // Query the server on every continuation: it is authoritative even if an aborted
    // request finished writing a chunk before the browser saw its response.
    const previousSession = uploadRef.current
    const nextSession = createUploadSessionState()
    if (pendingUpload) {
      nextSession.displayedBytes = Math.max(pendingUpload.uploadedBytes || 0,
        previousSession.sessionId === pendingUpload.sessionId ? previousSession.displayedBytes || 0 : 0)
    }
    uploadRef.current = nextSession
    uploadShareInChunks(orderedFiles, {}, uploadRef, ({ progress, status, ...check }) => {
      if (submitRunRef.current === submitRun) {
        setProgress(progress)
        if (status === 'finalizing') { setUploadPhase('finalizing'); setCheckState(check) }
      }
    }, {
      ...resumeConfig,
      sessionBody: {
        mode: 'collection',
        collectionToken: token,
        participantName,
        relativePaths: orderedFiles.map((item) => item.relativePath),
        // The local fingerprint includes modification times to reject changed files.
        ...(pendingUpload ? pendingUpload.fileLastModified ? { fileLastModified: pendingUpload.fileLastModified } : {} : { fileLastModified: orderedFiles.map((item) => item.file.lastModified) }),
      },
      completeBody: { mode: 'collection' },
    }).then((result) => {
      if (submitRunRef.current !== submitRun) return
      const submittedAt = result.submission?.submittedAt || new Date().toISOString()
      savePublicRecord(createCollectionRecord(collection, 'collect_from_me', { participantName, submittedAt, files: result.submission?.files || files }))
      setMessage('提交成功，感谢你的文件')
      setFiles([])
      setPendingUpload(null)
      setUploadPhase('idle')
      uploadRef.current = createUploadSessionState()
    }).catch(async (err) => {
      if (submitRunRef.current !== submitRun) return
      const entry = readCollectionUploadResume(token)
      setPendingUpload(entry)
      setCompletionPending(Boolean(err.completionPending))
      setUploadPhase(err.code === 'scan_threat_detected' ? 'blocked' : err.completionPending ? 'query' : String(err.code || '').startsWith('scan_') ? 'scan-failed' : entry ? 'paused' : 'idle')
      setMessage(err.name === 'UploadPausedError' ? '上传已暂停，已上传分片已保存，可继续上传' : err.message)
      if (entry) {
        try {
          const restored = await queryUploadResume(entry)
          if (submitRunRef.current === submitRun) { setPendingUpload(restored); setProgress(current => Math.max(current, restored.progress)) }
        } catch { /* Keep the record on transient failure; retry queries it again. */ }
      }
    }).finally(() => {
      if (submitRunRef.current === submitRun) {
        setSubmitting(false)
      }
    })
  }
  return (
    <PublicShell className="collection-submit-shell">
      <div className="public-card collection-submit-card">
        <span className="public-icon"><Inbox size={24} /></span>
        {collection ? (
          <>
            <p className="eyebrow">文件收集</p>
            <h1>{collection.title}</h1>
            <p className="public-copy">{collection.description}</p>
            <div className="deadline-line"><Clock3 size={15} /> 截止 {formatDate(collection.deadline)}</div>
            <CollectionLimitInfo allowedTypes={collection.allowedTypes} maxFileSizeMb={collection.maxFileSizeMb} />
            {authChecked && (
              signedIn ? (
                <div className="collection-identity signed-in">
                  <span className="collection-identity-avatar"><UserAvatar user={user} /></span>
                  <div className="collection-identity-copy">
                    <small>提交人</small>
                    <strong>{displayUserName(user)}</strong>
                    <span>本次提交会记录你的鲲穹账号，收集方可以核对是谁提交的</span>
                  </div>
                  <button type="button" className="collection-identity-switch" disabled={submitting || Boolean(pendingUpload)} onClick={() => setUser(null)}><UserRound size={14} /> 改用其他名称</button>
                </div>
              ) : (
                <div className="collection-identity anonymous">
                  <span className="collection-identity-avatar"><UserRound size={17} /></span>
                  <div className="collection-identity-copy">
                    <small>提交人</small>
                    <strong>当前未登录</strong>
                    <span>登录后提交会带上你的账号信息，方便收集方识别；也可以直接填写名称匿名提交</span>
                  </div>
                  <button type="button" className="secondary-button collection-identity-login" disabled={submitting} onClick={startLogin}><UserRound size={15} /> 登录后提交</button>
                </div>
              )
            )}
            {(!signedIn || !authChecked) && (
              <label className="public-label">提交人名称<input value={name} maxLength={40} disabled={submitting || Boolean(pendingUpload)} onChange={(event) => setName(event.target.value)} placeholder="例如：张三 / 市场部" /></label>
            )}
            {pendingUpload && <div className="collection-resume-notice" role="status">
              <strong>发现未完成的上传 · {pendingUpload.files.length} 个文件</strong>
              <span>{pendingUpload.files.map((file) => file.relativePath || file.name).join('、')}</span>
              <span>{uploadPhase === 'blocked' ? '安全检查发现风险，请放弃本次上传并更换文件' : completionPending ? '文件已上传，查询处理结果即可，无需重复传输' : uploadPhase === 'scan-failed' ? '文件已上传，可重试安全检查' : files.length ? '将从已保存的分片继续上传' : '刷新后请重新选择原文件或文件夹，已上传分片会自动跳过'}</span>
            </div>}
            <input ref={inputRef} type="file" multiple hidden disabled={submitting || completionPending} accept={collectionFileAccept(collection.allowedTypes)} onChange={(event) => { handleSelectFiles(event.target.files); event.target.value = '' }} />
            <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden disabled={submitting || completionPending} onChange={(event) => { handleSelectFiles(event.target.files); event.target.value = '' }} />
            <div className="public-drop collection-file-picker">
              <UploadCloud size={24} />
              <strong>{files.length ? '继续添加文件或文件夹' : '选择要提交的文件或文件夹'}</strong>
              <span>支持追加选择，保留文件夹目录 · 单次最多 {MAX_FILES} 个文件</span>
              <div className="collection-picker-buttons">
                <button type="button" className="primary-button" disabled={submitting || completionPending} onClick={() => inputRef.current?.click()}><FileText size={16} /> 选择文件</button>
                <button type="button" className="secondary-button" disabled={submitting || completionPending} onClick={() => folderInputRef.current?.click()}><FolderOpen size={16} /> 选择文件夹</button>
              </div>
            </div>
            {files.length > 0 && <div className="public-files collection-selected-files" role="region" aria-label="已选文件列表" tabIndex={0}>{files.map((file) => <FileRow key={file.id} file={file} showPath onRemove={submitting || completionPending ? undefined : () => removeSelectedFile(file.id)} />)}</div>}
            <div className="collection-submit-actions">
              <div className="collection-selection-summary">
                <span aria-live="polite"><strong>{files.length}</strong> / {MAX_FILES} 个文件 · 共 {formatBytes(selectedBytes)}</span>
                {files.length > 0 && !pendingUpload && <button type="button" className="collection-clear-files" disabled={submitting} onClick={() => { setFiles([]); setMessage(''); setProgress(0) }}><Trash2 size={13} /> 清空</button>}
              </div>
              {(submitting || pendingUpload) && <div className="progress-wrap"><div className="progress-label"><span>{uploadPhase === 'finalizing' ? '正在校验文件并完成提交...' : uploadPhase === 'blocked' ? '安全检查发现风险，已阻止提交' : uploadPhase === 'scan-failed' ? '文件已上传，安全检查未完成' : uploadPhase === 'query' ? '文件已上传，处理结果待查询' : uploadPhase === 'pausing' ? '正在暂停...' : submitting ? '正在分片上传...' : '已暂停 · 可继续上传'}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
              {uploadPhase === 'finalizing' && <SecurityCheckStatus startedAt={checkState.checkStartedAt} stage={checkState.checkStage} currentFile={checkState.currentFile} fileIndex={checkState.checkFileIndex} fileCount={checkState.checkFileCount} completedCount={checkState.checkCompletedCount} activeCount={checkState.checkActiveCount} connectionMessage={checkState.connectionMessage} />}
              {(selectionError || message) && <FeedbackMessage message={selectionError || message} tone={selectionError || ['blocked', 'scan-failed', 'query'].includes(uploadPhase) ? 'error' : feedbackTone(message)} />}
              {submitting && ['uploading', 'pausing'].includes(uploadPhase) && <button className="secondary-button wide" disabled={uploadPhase === 'pausing'} onClick={pauseSubmit}><Pause size={16} /> {uploadPhase === 'pausing' ? '正在暂停...' : '暂停上传'}</button>}
              {pendingUpload && !submitting && !completionPending && <button className="secondary-button wide" onClick={abandonUpload}><X size={16} /> 放弃本次上传</button>}
              <button className="primary-button wide" onClick={submit} disabled={submitting || uploadPhase === 'blocked' || !files.length || Boolean(selectionError) || !resumeMatches}>{pendingUpload ? <Play size={17} /> : <UploadCloud size={17} />} {submitting ? uploadPhase === 'finalizing' ? '正在完成提交...' : '提交中...' : uploadPhase === 'blocked' ? '风险文件已阻止' : completionPending ? '查询处理结果' : uploadPhase === 'scan-failed' ? '重试安全检查' : pendingUpload ? '继续上传' : '提交文件'}</button>
            </div>
          </>
        ) : (
          <StateBlock title="无法打开收集任务" detail={message || '正在加载任务'} />
        )}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

export function CollectionManagePage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // destroyed 状态已移除：销毁收集任务在记录页完成（DELETE 后管理页 GET 会 404，走 error 分支）
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const saveManagedCollection = (collection) => {
    setActionError('')
    setActionMessage('')
    setData(collection)
    saveAuthoritativeLocalRecord(createCollectionRecord(collection, 'my_collections'))
  }

  useEffect(() => {
    apiRequest(`/api/collections/manage/${token}`).then((result) => {
      saveManagedCollection(result.collection)
    }).catch((err) => setError(err.message))
  }, [token])

  const saveTaskSettings = async (payload) => {
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const closeTask = async () => {
    const confirmed = await requestConfirm({
      title: '关闭收集任务',
      detail: '关闭后提交者将不能继续上传，已收文件仍可在管理页查看。确定关闭这个收集任务吗？',
      confirmText: '关闭收集',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const reopenTask = async (patch = {}) => {
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, status: 'active' }) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const deleteSubmission = async (submissionId) => {
    const confirmed = await requestConfirm({
      title: '删除提交记录',
      detail: '删除后该提交记录和文件会从本机服务中移除。确定删除吗？',
      confirmText: '删除提交',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const copyPublicValue = async (value) => {
    setActionError('')
    setActionMessage('')
    try {
      await copyTextToClipboard(value)
      setActionMessage('已复制到剪贴板')
    } catch {
      setActionError('当前浏览器不支持自动复制，请手动复制链接')
    }
  }
  const copyPublicQrImage = async (dataUrl, fallbackText) => {
    setActionError('')
    setActionMessage('')
    try {
      await copyImageToClipboard(dataUrl)
      setActionMessage('二维码图片已复制')
    } catch {
      try {
        await copyTextToClipboard(fallbackText || dataUrl)
        setActionMessage('当前浏览器不支持直接复制图片，已复制链接')
      } catch {
        setActionError('当前浏览器不支持自动复制，请手动复制链接')
      }
    }
  }
  const downloadAll = () => startDownload(createCollectionDownloadConfig(data))
  const downloadSubmissionItem = (submission) => startDownload(createSubmissionDownloadConfig(data, submission))
  const downloadFile = (submission, fileIndex) => startDownload(createSubmissionFileDownloadConfig(data, submission, fileIndex))
  const previewFile = (submission, fileIndex) => setPreviewItem(createSubmissionFilePreviewConfig(data, submission, fileIndex))
  if (error) return <PublicShell><StateBlock title="管理链接不可用" detail={error} /></PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const isActive = data.status === 'active'
  const manageTarget = { kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data }
  return (
    <PublicShell>
      <div className="public-card manage-card">
        <p className="eyebrow">收集任务管理</p>
        <div className="manage-title-row">
          <h1>{data.title}</h1>
          <div className="manage-title-actions">
            <button className="secondary-button" disabled={!data.publicUrl} onClick={() => copyPublicValue(data.publicUrl)}><Link2 size={15} /> 复制提交链接</button>
            <button className="secondary-button" disabled={!data.qrDataUrl} onClick={() => setQrOpen(true)}><QrCode size={15} /> 查看二维码</button>
            <button className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 编辑任务</button>
            {isActive ? (
              <button className="secondary-button danger-lite" onClick={closeTask}><X size={15} /> 关闭收集任务</button>
            ) : canReopenCollection(data) ? (
              <button className="secondary-button" onClick={() => reopenTask()}><RefreshCw size={15} /> 重新开启任务</button>
            ) : (
              <button className="secondary-button" onClick={() => setEditing(true)}><CalendarDays size={15} /> 延长后开启</button>
            )}
          </div>
        </div>
        <p className="public-copy">{data.submissions.length} 份提交 · 状态：{collectionStatusText(data.status, data.deadline)}</p>
        {actionMessage && <FeedbackMessage message={actionMessage} tone="success" />}
        {actionError && <FeedbackMessage message={actionError} tone="error" />}
        <CollectionLimitInfo allowedTypes={data.allowedTypes} maxFileSizeMb={data.maxFileSizeMb} />
        {data.submissions.length > 0 && <button className="primary-button wide collection-download-all" onClick={downloadAll} disabled={downloadBusy}><Download size={16} /> 打包下载全部提交</button>}
        <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
        <div className="manage-list collection-manage-list" role="region" aria-label="已收提交列表" tabIndex={0}>
          {data.submissions.length ? data.submissions.map((submission) => (
            <div className="manage-submission" key={submission.id}>
              <div>
                <div className="collection-submission-who">
                  <strong>{submission.participantName}</strong>
                  {submission.submitter
                    ? <span className="submission-account-badge" title={`鲲穹账号：${submission.submitter.displayName || submission.submitter.id}`}><UserRound size={12} /> 账号提交</span>
                    : <span className="submission-anon-badge">匿名提交</span>}
                </div>
                <span>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件</span>
                <div className="manage-file-names" role="region" aria-label={`${submission.participantName}的文件列表`} tabIndex={0}>{submission.files.map((file, fileIndex) => <span className="manage-file-chip" key={`${submission.id}-${file.relativePath}`}>{canPreviewFile(file) && <button className="manage-file-icon" aria-label={`预览 ${file.name}`} onClick={() => previewFile(submission, fileIndex)}><Eye size={13} /></button>}<button onClick={() => downloadFile(submission, fileIndex)} disabled={downloadBusy}><FileText size={13} /> <FileFormatBadge file={file} /> {file.name}</button></span>)}</div>
              </div>
              <div className="manage-submission-actions">
                <button className="secondary-button" onClick={() => downloadSubmissionItem(submission)} disabled={downloadBusy}><Download size={15} /> 下载</button>
                <button className="secondary-button danger-lite" onClick={() => deleteSubmission(submission.id)}><Trash2 size={15} /> 删除提交</button>
              </div>
            </div>
          )) : (
            <div className="empty-manage"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
          )}
        </div>
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      </div>
      {editing && <ManageItemModal target={manageTarget} onClose={() => setEditing(false)} onSave={saveTaskSettings} onCloseTask={async () => { const closed = await closeTask(); if (closed) setEditing(false); return closed }} onReopenTask={async (payload) => { const reopened = await reopenTask(payload); if (reopened) setEditing(false); return reopened }} />}
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail={data.title || '提交链接'}
          qrDataUrl={data.qrDataUrl}
          targetUrl={data.publicUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => copyPublicQrImage(data.qrDataUrl, data.publicUrl)}
          onCopyLink={() => copyPublicValue(data.publicUrl)}
        />
      )}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
    </PublicShell>
  )
}
