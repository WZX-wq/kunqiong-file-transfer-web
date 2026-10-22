import React from 'react'
import { copyImageWithFeedback, copyTextWithFeedback } from '../lib/clipboard-feedback.js'
import { SecurityCheckFailure, SecurityCheckStatus } from '../components/security-check-status.jsx'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, createShareFileDownloadConfig, createSubmissionFileDownloadConfig, createUploadSessionState } from '../lib/api.js'
import { ConfirmModal, FeedbackMessage, LoadingBlock, PublicShell, StateBlock, Toast } from '../components/common.jsx'
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, CheckCircle2, Clock3, Copy, Download, Eye, FileText, FolderOpen, Inbox, Info, KeyRound, Link2, Lock, Pause, Play, QrCode, RefreshCw, Settings2, ShieldCheck, Trash2, UploadCloud, UserRound, Users, X } from 'lucide-react'
import { PrototypeAsset, PrototypeFileIcon } from '../components/prototype-asset.jsx'
import { ProtoStateCard, ProtoBadge, ProtoBanner } from '../components/prototype-ui.jsx'
import { CollectionLimitInfo, DownloadProgressPanel, FileFormatBadge, FilePreviewModal, FileRow, ManageItemModal, QrPreviewModal, TeamJoinRequestCard, UserAvatar, toFileItems } from '../components/ui.jsx'
import { useConfirmDialog, useDownloadTask, useToast } from '../hooks.js'
import { canReopenCollection, collectionFileAccept, collectionStatusText, createCollectionRecord, createShareRecord, isAllowedCollectionFile, saveAuthoritativeLocalRecord, savePublicRecord, shareStatusText } from '../lib/records.js'
import { canPreviewFile, clearUploadResume, createCollectionDownloadConfig, createShareDownloadConfig, createShareFilePreviewConfig, createSubmissionDownloadConfig, createSubmissionFilePreviewConfig, queryUploadResume, readCollectionUploadResume, uploadShareInChunks } from '../lib/transfer.js'
import { displayUserName, feedbackTone, formatBytes, formatDate, formatExpiry } from '../lib/format.js'
import { MAX_FILES } from '../lib/constants.js'
import { limitInputText } from '../lib/input-limits.js'

export function TeamInvitePage({ slug }) {
  // 落地页自己探一次团队是否存在：无效 slug 时上方导语必须换成「链接已失效」，
  // 否则页面会一边说「你收到一个团队空间邀请」、一边渲染不出任何可操作入口，自相矛盾。
  const [probe, setProbe] = useState(null)
  const [probeVersion, setProbeVersion] = useState(0)
  useEffect(() => {
    if (!slug) return undefined
    let active = true
    setProbe(null)
    apiRequest(`/api/organizations/${encodeURIComponent(slug)}/join-request`)
      .then((result) => { if (active) setProbe(result) })
      .catch(error => { if (active) setProbe({ available:false, reason:[404,410].includes(error.status) ? 'unavailable' : 'error', message:error.message || '团队信息加载失败，请重试' }) })
    return () => { active = false }
  }, [slug, probeVersion])
  const invalid = probe && probe.reason === 'unavailable'
  return (
    <PublicShell>
      <section className="team-invite-page">
        {invalid && (
          <div className="team-invite-hero">
            <span className="team-invite-hero-icon"><Building2 size={26} /></span>
            <p className="eyebrow">团队空间邀请</p>
            <h1>这个邀请链接已失效</h1>
            <p>该团队不存在或已解散，请联系邀请你的人重新获取链接。</p>
          </div>
        )}
        {probe?.reason === 'error' && <><FeedbackMessage message={probe.message} tone="error" /><button className="secondary-button" onClick={() => setProbeVersion(value => value + 1)}>重新加载</button></>}
        {!invalid && probe?.reason !== 'error' && probe && <TeamInviteLandingCard slug={slug} probe={probe} />}
      </section>
    </PublicShell>
  )
}

// 团队邀请落地卡：对齐原型 space.js · invite（logo + 徽标 + 团队信息盒 + 权益清单 + 主按钮 + 底部出口）。
// 团队数据全部来自探测接口的真实字段；未覆盖的状态（已是成员 / 冷却中…）按钮置灰并给出原因。
function TeamInviteLandingCard({ slug, probe }) {
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [state, setState] = useState(probe)
  useEffect(() => { setState(probe) }, [probe])
  const teamName = state.organizationName || '该团队'
  const spaceLabel = state.teamSpaceBytes ? formatBytes(state.teamSpaceBytes) : ''
  const login = () => {
    const returnTo = `${window.location.origin}/e/${encodeURIComponent(slug)}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setFeedback('')
    try {
      const result = await apiRequest(`/api/organizations/${encodeURIComponent(slug)}/join-request`, { method: 'POST', body: JSON.stringify({}) })
      setState((current) => ({ ...current, available: false, reason: 'pending', requestedAt: result.requestedAt || new Date().toISOString() }))
    } catch (err) {
      setFeedback(err.message || '申请提交失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }
  const actions = {
    anonymous: { label: '登录后申请加入', onClick: login },
    eligible: { label: '接受邀请并加入', onClick: submit },
    invited: { label: '到消息中心接受邀请', href: '/workspace' },
    pending: { label: '申请已提交，等待审批', disabled: true },
    member: { label: '你已是团队成员', disabled: true },
    owner: { label: '你是该团队的所有者', disabled: true },
    other_team: { label: '你已加入其他团队空间', disabled: true },
    cooldown: { label: '暂时无法申请', disabled: true },
  }
  const action = actions[state.reason] || { label: '申请加入团队', disabled: true }
  const cooldownHours = state.cooldownUntil ? Math.max(1, Math.ceil((new Date(state.cooldownUntil).getTime() - Date.now()) / 3600000)) : 0
  const statusText = {
    anonymous: '登录鲲穹账号后，即可向团队所有者申请加入。',
    pending: '申请已提交，等待团队所有者同意或拒绝。',
    invited: '你已收到该团队的邀请，请到消息中心选择接受或拒绝。',
    member: '你已经是该团队成员。',
    owner: '你是该团队的所有者。',
    other_team: '你已加入其他团队空间，无法重复加入。',
    cooldown: cooldownHours ? `上次申请未通过，请 ${cooldownHours} 小时后再试。` : '',
  }[state.reason] || ''
  const initials = Array.isArray(state.memberInitials) ? state.memberInitials.slice(0, 4) : []
  const moreCount = Math.max(0, Number(state.memberCount) || 0) - initials.length
  return (
    <div className="invite-card public-card">
      <div className="invite-top">
        <span className="team-invite-hero-icon"><Building2 size={24} /></span>
        <span className="badge blue"><i />团队空间邀请</span>
      </div>
      <h1>你收到一个团队空间邀请</h1>
      <p className="invite-sub">{state.ownerName || '团队所有者'} 邀请你加入「{teamName}」，一起共享文件与收集任务。</p>
      <div className="invite-team">
        <div className="invite-team-line">
          <div><b>{teamName}</b><small>{state.memberCount || 0} 位成员 · {state.planLabel || '团队版'}</small></div>
          {spaceLabel && <span className="badge">{spaceLabel} 共享空间</span>}
        </div>
        {initials.length > 0 && (
          <div className="team-avatars invite-avatars">
            {initials.map((ch, index) => <span className="avatar sm" key={`${ch}-${index}`}>{ch}</span>)}
            {moreCount > 0 && <span className="avatar sm more">+{moreCount}</span>}
          </div>
        )}
      </div>
      <ul className="invite-benefits">
        <li><CheckCircle2 size={16} /><div><b>{spaceLabel ? `共享 ${spaceLabel} 团队空间` : '共享团队空间'}</b><small>团队文件独立于个人容量</small></div></li>
        <li><CheckCircle2 size={16} /><div><b>访问团队专属资源</b><small>团队共享的文件与交付内容</small></div></li>
        <li><CheckCircle2 size={16} /><div><b>参与团队收集任务</b><small>统一提交与归档</small></div></li>
      </ul>
      {feedback && <FeedbackMessage message={feedback} tone="error" />}
      {action.href
        ? <a className="primary-button invite-cta" href={action.href}>{action.label}</a>
        : <button className="primary-button invite-cta" onClick={action.onClick} disabled={action.disabled || submitting}>{submitting ? '提交中…' : action.label}</button>}
      <p className="tiny center invite-note">加入需要登录鲲穹账号 · 管理员审批后生效</p>
      {(statusText || state.requestedAt) && <p className="invite-status">{statusText}{state.requestedAt && statusText ? ' · ' : ''}{state.requestedAt ? `申请于 ${formatDate(state.requestedAt)} 提交` : ''}</p>}
      <div className="invite-foot">
        <span>{state.createdAt ? `团队创建于 ${formatDate(state.createdAt)}` : '鲲穹文件传输 · 团队空间'}</span>
        <a href="/">暂不加入</a>
      </div>
    </div>
  )
}

// 分享已过期：对齐原型 share.js · share-expired（灰钟图标 + 三项元信息 + 两个出口）。
// 元信息来自服务端 410 的脱敏字段，不做任何猜测；分享人沿用分享页固定的品牌称谓。
function ShareExpiredCard({ info }) {
  return (
    <ProtoStateCard
      icon={Clock3}
      tone="gray"
      title="这个分享已过期"
      detail={<>文件保留期已结束，内容已进入清理流程，无法继续下载。<br />如需再次获取，请联系发送人重新分享。</>}
      actions={<>
        <a className="secondary-button" href="/?view=send">输入其他取件码</a>
        <a className="primary-button" href="/">我也要发文件</a>
      </>}
    >
      <div className="expired-meta">
        <div><span>分享人</span><b>鲲穹文件传输</b></div>
        <div><span>过期时间</span><b>{info.expiresAt ? formatDate(info.expiresAt) : '—'}</b></div>
        <div><span>文件</span><b>{info.fileCount || 0} 个{info.totalSize ? ` · ${formatBytes(info.totalSize)}` : ''}</b></div>
      </div>
    </ProtoStateCard>
  )
}

// 分享已关闭：对齐原型 share.js · share-closed（灰锁 + 说明 + 提示条 + 两个出口）。
// 关闭不会删除云端文件，提示条把「可重新开启」这条真实能力讲清楚，避免接收方误以为文件被删。
function ShareClosedCard() {
  return (
    <ProtoStateCard
      icon={Lock}
      tone="gray"
      title="分享已被关闭"
      detail={<>发送人已停止此分享，链接与取件码都无法继续访问。<br />如果你是接收方，请联系发送人重新分享。</>}
      actions={<>
        <a className="secondary-button" href="/?view=send">输入其他取件码</a>
        <a className="primary-button" href="/">返回首页</a>
      </>}
    >
      <div className="closed-notice">
        <ProtoBanner tone="info" icon={Info}>关闭分享不会删除云端文件，发送人仍可在「收发记录」中重新开启或再次分享。</ProtoBanner>
      </div>
    </ProtoStateCard>
  )
}

// 正在下载文件：对齐原型 share.js · download-progress 的版式（hero + 发送人条 + 文件卡）。
// 产品把传输交给浏览器下载管理器，前端拿不到字节级进度，因此这里只呈现真实状态：
// 准备中/下载中/失败，以及文件清单；不编造百分比、速度和“暂停”（浏览器下载无法由页面暂停）。
function ShareDownloadingPage({ share, task, onBack, onRetry }) {
  const files = share.files || []
  const totalSize = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const allApproved = files.length > 0 && files.every((file) => file.reviewStatus === 'approved')
  const archive = files.length > 1
  const failed = task.status === 'failed'
  const activeName = task.filename || (archive ? '鲲穹文件包.zip' : files[0]?.name) || '下载文件'
  const statusText = failed ? '下载失败' : task.status === 'preparing' ? '准备下载' : '下载中'
  return (
    <div className="share-main download-page">
      <header className="share-hero">
        <span className="eyebrow">鲲穹临时分享</span>
        <h1>正在下载文件</h1>
        <p>下载已交给浏览器，进度和保存位置请在浏览器下载列表中查看。</p>
      </header>
      <div className="sender download-sender">
        <span className="avatar"><PrototypeAsset name="ico-user.png" size={28} /></span>
        <div className="who"><b>鲲穹文件传输</b><small>临时分享 · {formatDate(share.createdAt)}</small></div>
        {allApproved && <ProtoBadge tone="blue" dot={false}><ShieldCheck size={12} /> 安全检测通过</ProtoBadge>}
      </div>
      <div className="public-card share-card download-card">
        <div className="card-bd">
          <div className="pkg-head">
            <div><h3>{files.length} 个文件</h3><p className="tiny">共 {formatBytes(totalSize)} · {share.requiresPassword ? '受提取密码保护' : '无需登录'}</p></div>
            <ProtoBadge tone={failed ? 'danger' : 'blue'}>{statusText}</ProtoBadge>
          </div>
          {failed ? <DownloadProgressPanel task={task} onRetry={onRetry} /> : (
            <>
              <div className="download-task">
                <div className="download-task-head">
                  <Download size={16} />
                  <b title={activeName}>{activeName}</b>
                  <span>{files.length} 个文件 · {formatBytes(totalSize)}</span>
                </div>
                <div className="download-track" role="progressbar" aria-label="浏览器正在下载，具体进度见浏览器下载列表"><span /></div>
                <p className="download-task-note">{task.status === 'preparing' ? '正在准备下载链接，浏览器随后会提示保存位置。' : '浏览器已接管本次下载。若没有看到保存提示，请检查浏览器的下载列表或拦截提示。'}</p>
              </div>
              <div className="download-file-list">
                {files.map((file, index) => (
                  <div className="download-file-row" key={file.relativePath || `${file.name}-${index}`}>
                    <span className="download-file-icon"><PrototypeFileIcon name={file.name} fallback={FileText} size={24} /></span>
                    <div className="download-file-copy"><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}</small></div>
                    <span className="download-file-state">{archive ? '已包含' : '浏览器下载中'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="download-actions">
            <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> 返回文件列表</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SharePage({ token, enterpriseSlug = '' }) {
  const { toast, notify } = useToast()
  const [data, setData] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [goneInfo, setGoneInfo] = useState(null)
  const [actionError, setActionError] = useState('')
  const [requiresLogin, setRequiresLogin] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  // 下载任务的独立页面（对齐原型 share.js · download-progress）：点击下载后进入，
  // 返回文件列表时关闭；任务状态本身仍由 useDownloadTask 持有。
  const [downloadPageOpen, setDownloadPageOpen] = useState(false)
  useEffect(() => {
    const query = enterpriseSlug ? `?organization=${encodeURIComponent(enterpriseSlug)}` : ''
    apiRequest(`/api/shares/token/${token}${query}`).then((result) => {
      setData(result)
      savePublicRecord(createShareRecord(result.share, 'sent_to_me'))
    }).catch((err) => {
      setError(err.message)
      setRequiresLogin(err.code === 'directed_login_required')
      // 已过期 / 已关闭走原型里的专用状态页；次数用尽等仍用通用不可用页。
      if (err.status === 410 && ['expired', 'closed'].includes(err.shareMeta?.state)) setGoneInfo(err.shareMeta)
    })
  }, [token, enterpriseSlug])
  const findShare = async () => {
    try {
      const result = await apiRequest(`/api/shares/lookup/${data.share.code}`, { method: 'POST', body: JSON.stringify({ password }) })
      setData(result)
      setActionError('')
      savePublicRecord(createShareRecord(result.share, 'sent_to_me'))
    } catch (err) { setActionError(err.message) }
  }
  if (goneInfo?.state === 'expired') return <PublicShell><ShareExpiredCard info={goneInfo} /></PublicShell>
  if (goneInfo?.state === 'closed') return <PublicShell><ShareClosedCard /></PublicShell>
  if (error) return <PublicShell><StateBlock title="这个分享暂时不可用" detail={error} />{requiresLogin && <button className="primary-button" onClick={() => { window.location.href = `/api/auth/login?return_to=${encodeURIComponent(window.location.href)}` }}><UserRound size={16} /> 使用收件账号登录</button>}</PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const share = data.share
  const beginDownload = (config) => {
    setDownloadPageOpen(true)
    return startDownload(config)
  }
  const downloadAll = () => beginDownload(createShareDownloadConfig(share, { password }))
  const downloadFile = (file, fileIndex) => beginDownload(createShareFileDownloadConfig(share, file, fileIndex, { password }))
  const previewFile = (file, fileIndex) => setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex, { password }))
  if (downloadPageOpen) return (
    <PublicShell>
      <ShareDownloadingPage share={share} task={downloadTask} onBack={() => setDownloadPageOpen(false)} onRetry={retryDownload} />
    </PublicShell>
  )
  const copyShareQr = () => copyImageWithFeedback(share.qrDataUrl, share.shareUrl, notify)
  const copyShareUrl = () => copyTextWithFeedback(share.shareUrl, notify, '分享链接已复制')
  const totalSize = (share.files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  return (
    <PublicShell>
      {toast && <Toast {...toast} />}
      <div className="share-main">
        <header className="share-hero">
          <span className="eyebrow">鲲穹临时分享</span>
          <h1>有人给你发来了文件</h1>
          <p>分享有效期：{formatExpiry(share.expiresAt)}，请及时下载保存。</p>
        </header>
        {data.requiresPassword && !share.files?.length ? (
          <div className="public-card password-card share-locked-card">
            <PrototypeAsset className="big-ico-image" name="ico-lock.png" width={70} height={70} />
            <h2>此分享已加密</h2>
            <p>请输入发送人提供的提取密码，验证后即可查看文件。</p>
            <form className="public-password" onSubmit={(event) => { event.preventDefault(); findShare() }}>
              <input maxLength={128} type="password" value={password} onChange={(event) => setPassword(limitInputText(event.target.value, 128))} placeholder="请输入提取密码，最多 128 个字符" />
              <button className="primary-button" type="submit" disabled={!password}><KeyRound size={15} /> 验证密码</button>
            </form>
            <small>{password.length}/128</small>
            {actionError && <FeedbackMessage message={actionError} tone="error" />}
          </div>
        ) : (
          <>
            <div className="sender">
              <span className="avatar"><PrototypeAsset name="ico-user.png" size={28} /></span>
              <div className="who"><b>鲲穹文件传输</b><small>临时分享 · {formatDate(share.createdAt)}</small></div>
            </div>
            <div className="public-card share-card share-public-card">
              <div className="card-bd">
                <div className="pkg-head">
                  <div><h3>{share.files?.length || 0} 个文件</h3><p className="tiny">共 {formatBytes(totalSize)} · 上传于 {formatDate(share.createdAt)}</p></div>
                  <span className={`badge ${share.status === 'active' ? 'ok' : 'warn'}`}><i />{share.downloadLimit ? `剩余 ${share.remainingDownloads ?? 0} 次下载` : formatExpiry(share.expiresAt)}</span>
                </div>
                <div className="public-files share-file-list">
                  {(share.files || []).map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={downloadBusy} />)}
                </div>
                <div className="share-actions">
                  <button className="primary-button" onClick={downloadAll} disabled={downloadBusy || !(share.files || []).length}><Download size={17} /> {(share.files || []).length > 1 ? `全部下载（${formatBytes(totalSize)}）` : '下载文件'}</button>
                  <button className="secondary-button" onClick={() => setQrOpen(true)} disabled={!share.qrDataUrl}><QrCode size={16} /> 二维码</button>
                </div>
                <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
              </div>
            </div>
            <p className="share-note"><PrototypeAsset name="ico-lock.png" size={18} /> 文件仅用于本次分享，到期后自动清理 · 由鲲穹文件传输提供</p>
          </>
        )}
        {actionError && !data.requiresPassword && <FeedbackMessage message={actionError} tone="error" />}
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startDownload(config || previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
        {qrOpen && <QrPreviewModal title="扫码在手机上下载" detail="扫码后可直接预览并下载；如设置了密码，需先输入。" qrDataUrl={share.qrDataUrl} targetUrl={share.shareUrl} onClose={() => setQrOpen(false)} onCopyImage={copyShareQr} onCopyLink={copyShareUrl} />}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

export function ShareManagePage({ token }) {
  const { toast, notify } = useToast()
  const [share, setShare] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
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
      notify('分享设置已保存', 'success')
      return true
    } catch (err) {
      notify(err.message || '分享设置保存失败，请重试', 'error')
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
      notify('分享已关闭', 'success')
      return true
    } catch (err) {
      notify(err.message || '关闭分享失败，请重试', 'error')
      return false
    }
  }

  const reopenShare = async (payload) => {
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...payload, status: 'active' }) })
      setShare(result.share)
      savePublicRecord(createShareRecord(result.share, 'my_sent'))
      notify('分享已重新开启', 'success')
      return true
    } catch (err) {
      notify(err.message || '重新开启分享失败，请重试', 'error')
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
  const copyShareUrl = () => copyTextWithFeedback(share.shareUrl, notify, '分享链接已复制')
  const copyShareQr = () => copyImageWithFeedback(share.qrDataUrl, share.shareUrl, notify)

  return (
    <PublicShell className="share-manage-shell">
      {toast && <Toast {...toast} />}
      <div className="share-manage-page">
        <header className="share-manage-heading">
          <div>
            <a className="manage-back-link" href={share.enterpriseUrl ? '/team?tab=resources' : '/?view=records'}><ArrowLeft size={15} />{share.enterpriseUrl ? '返回团队资源' : '返回收发记录'}</a>
            <p className="eyebrow">分享管理</p>
            <h1>{share.files?.[0]?.name || '文件分享'} <span className={`badge ${isActive ? 'ok' : 'warn'}`}><i />{shareStatusText(share.status)}</span></h1>
            <p>创建于 {formatDate(share.createdAt)} · 管理链接含访问凭证，请勿公开转发</p>
          </div>
          <div className="share-manage-actions">
            <button className="secondary-button" onClick={copyShareUrl}><Link2 size={15} /> 复制链接</button>
            <button className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 分享设置</button>
          </div>
        </header>
        <div className="manage-stats">
          <div><span>下载次数</span><b>{share.downloadCount || 0}</b><small>{share.downloadLimit ? `上限 ${share.downloadLimit} 次` : '不限次数'}</small></div>
          <div><span>剩余下载</span><b>{share.remainingDownloads ?? '不限'}</b><small>{share.downloadLimit ? '达到上限后链接失效' : '下载不设次数限制'}</small></div>
          <div><span>剩余有效期</span><b>{formatExpiry(share.expiresAt)}</b><small>{share.expiresAt ? `到期 ${formatDate(share.expiresAt)}` : '长期有效'}</small></div>
          <div><span>文件大小</span><b>{formatBytes(totalSize)}</b><small>{fileCount} 个文件</small></div>
        </div>
        <div className="manage-grid share-manage-grid">
          <div className="share-manage-main">
            <section className="public-card share-manage-files">
              <div className="manage-panel-heading"><h2>文件列表</h2><span>支持在线预览的文件可直接打开</span></div>
              <div className="manage-file-list">
                {fileCount ? share.files.map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={!isActive || downloadBusy} />) : <div className="empty-manage"><FileText size={25} /><span>分享文件已关闭或清理</span></div>}
              </div>
            </section>
            <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
          </div>
          <aside className="share-manage-aside">
            <section className="public-card share-info-card">
              <div className="manage-panel-heading"><h2>分享信息</h2></div>
              <dl className="sum-list"><div><dt>取件码</dt><dd className="mono">{share.code}</dd></div><div><dt>提取密码</dt><dd>{share.requiresPassword ? '已启用' : '未启用'}</dd></div><div><dt>下载限制</dt><dd>{share.downloadLimit ? `${share.downloadLimit} 次` : '不限次数'}</dd></div><div><dt>已下载</dt><dd>{share.downloadCount || 0} 次</dd></div><div><dt>到期时间</dt><dd>{share.expiresAt ? formatDate(share.expiresAt) : '长期有效'}</dd></div></dl>
              {share.qrDataUrl && <button type="button" className="manage-qr-button" onClick={() => setQrOpen(true)} aria-label="放大分享二维码"><img src={share.qrDataUrl} alt="分享二维码" /><span>扫码取件 · 放大二维码</span></button>}
            </section>
            <section className="danger-zone"><h2>关闭分享</h2><p>关闭后链接和取件码立即失效，已下载文件不受影响。</p>{isActive ? <button className="secondary-button danger-lite" onClick={closeShare}><X size={15} /> 立即关闭</button> : <button className="secondary-button" onClick={() => reopenShare({})}><RefreshCw size={15} /> 重新开启</button>}</section>
          </aside>
        </div>
      </div>
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startDownload(config || previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      {editing && <ManageItemModal target={manageTarget} onClose={() => setEditing(false)} onSave={saveShareSettings} onCloseTask={async () => { const closed = await closeShare(); if (closed) setEditing(false); return closed }} onReopenTask={async (payload) => { const reopened = await reopenShare(payload); if (reopened) setEditing(false); return reopened }} />}
      {qrOpen && <QrPreviewModal title="分享二维码" detail={`取件码 ${share.code}`} qrDataUrl={share.qrDataUrl} targetUrl={share.shareUrl} onClose={() => setQrOpen(false)} onCopyImage={copyShareQr} onCopyLink={copyShareUrl} />}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
    </PublicShell>
  )
}

// 提交成功：对齐原型 collect.js · collect-submitted（绿勾 + 回执 + 复制/再提交）。
// 编号、文件数、时间、账号都来自服务端返回的真实 submission，不拼演示数据。
function CollectionSubmittedPage({ collection, submission, onAgain }) {
  const { toast, notify } = useToast()
  const copied = toast?.tone === 'success'
  const files = submission.files || []
  const totalBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const account = submission.submitter?.email || submission.submitter?.phone || submission.submitter?.displayName || ''
  const submittedAt = formatDate(submission.submittedAt)
  const copyReceipt = async () => {
    const lines = [
      `提交编号：${submission.id || '—'}`,
      `收集任务：${collection.title}`,
      `提交文件：${files.length} 个 · ${formatBytes(totalBytes)}`,
      `提交时间：${submittedAt}`,
      `关联账号：${account || '匿名提交'}`,
    ]
    return copyTextWithFeedback(lines.join('\n'), notify, '提交回执已复制')
  }
  return (
    <div className="public-card collection-state-card">
      {toast && <Toast {...toast} />}
      <PrototypeAsset className="collect-success-badge" name="act-success.png" size={64} />
      <h2>文件提交成功</h2>
      <p>收集人「{collection.ownerName || '收集人'}」已收到你的文件，无需重复提交。<br />如需补充材料，可在截止前再次提交。</p>
      <div className="collect-receipt">
        <div><span>提交编号</span><b>{submission.id || '—'}</b></div>
        <div><span>提交文件</span><b>{files.length} 个 · {formatBytes(totalBytes)}</b></div>
        <div><span>提交时间</span><b>{submittedAt}</b></div>
        <div><span>关联账号</span><b>{account || '匿名提交'}</b></div>
      </div>
      <div className="collect-state-actions">
        <button type="button" className="secondary-button" onClick={copyReceipt}><Copy size={15} /> {copied ? '已复制回执' : '复制回执'}</button>
        <button type="button" className="primary-button" onClick={onAgain}>再提交一份</button>
      </div>
      <p className="collect-state-note">提交已记录，文件已完成安全检查。如需补充材料，请在截止前再次提交。</p>
    </div>
  )
}

// 收集已截止/已关闭：对齐原型 collect.js · collect-closed（灰钟 + 三项元信息 + 首页/登录）。
function CollectionClosedPage({ info, signedIn }) {
  const expired = info.state === 'expired'
  const deadlineText = info.deadline ? formatDate(info.deadline) : '未设置截止时间'
  const loginHref = `/api/auth/login?return_to=${encodeURIComponent('/?view=records')}`
  return (
    <div className="public-card collection-state-card is-closed">
      <div className="collect-state-icon"><Clock3 size={27} /></div>
      <h2>{expired ? '收集已截止' : '收集已关闭'}</h2>
      <p>「{info.title || '收集任务'}」已于 {deadlineText} 停止收集。<br />如果你仍需要提交材料，请联系收集人重新开启。</p>
      <div className="expired-meta">
        <div><span>收集人</span><b>{info.ownerName || '收集人'}</b></div>
        <div><span>已收到</span><b>{info.participantCount || 0} 位提交</b></div>
        <div><span>截止时间</span><b>{deadlineText}</b></div>
      </div>
      <div className="collect-state-actions">
        <a className="secondary-button" href="/">返回首页</a>
        <a className="primary-button" href={signedIn ? '/?view=records' : loginHref}>{signedIn ? '查看我的提交' : '登录查看我的提交'}</a>
      </div>
    </div>
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
  const [scanFailure, setScanFailure] = useState(null)
  const [completionPending, setCompletionPending] = useState(false)
  const [pendingUpload, setPendingUpload] = useState(null)
  const [closedInfo, setClosedInfo] = useState(null)
  const [submissionInfo, setSubmissionInfo] = useState(null)
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
    }).catch((err) => {
      // 410 走原型里的「收集已截止」页；其余错误仍是通用不可用页。
      if (err.status === 410 && err.collectionMeta) setClosedInfo(err.collectionMeta)
      setMessage(err.message)
    })
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
          setScanFailure(failure)
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
      setScanFailure(null)
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
    setScanFailure(null)
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
      const submittedFiles = result.submission?.files || files
      savePublicRecord(createCollectionRecord(collection, 'collect_from_me', { participantName, submittedAt, files: submittedFiles }))
      setSubmissionInfo({ submission: { ...result.submission, submittedAt, files: submittedFiles } })
      setMessage('')
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
      setScanFailure(String(err.code || '').startsWith('scan_') ? err : null)
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
  if (closedInfo) return <PublicShell className="collection-submit-shell"><CollectionClosedPage info={closedInfo} signedIn={signedIn} /></PublicShell>
  if (collection && submissionInfo) return (
    <PublicShell className="collection-submit-shell">
      <CollectionSubmittedPage collection={collection} submission={submissionInfo.submission} onAgain={() => { setSubmissionInfo(null); setMessage('') }} />
    </PublicShell>
  )
  return (
    <PublicShell className="collection-submit-shell">
      <div className="public-card collection-submit-card">
        {collection ? (
          <>
            <header className="collection-submit-hero">
              <p className="eyebrow">文件收集</p>
              <h1>{collection.title}</h1>
              {collection.description && <p className="public-copy">{collection.description}</p>}
              <div className="collection-submit-meta">
                <div className="deadline-line"><Clock3 size={15} /> 截止 {formatDate(collection.deadline)}</div>
                <CollectionLimitInfo allowedTypes={collection.allowedTypes} maxFileSizeMb={collection.maxFileSizeMb} compact />
              </div>
            </header>
            <div className="collection-submit-body">
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
                  <span className="collection-identity-avatar"><PrototypeAsset name="ico-user.png" size={22} /></span>
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
              <PrototypeAsset className="collection-drop-image" name="ico-cloud.png" width={58} height={48} />
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
              {['blocked', 'scan-failed'].includes(uploadPhase) && <SecurityCheckFailure message={scanFailure?.message || message} code={scanFailure?.code} fileName={scanFailure?.scanFile} finding={scanFailure?.scanFinding} />}
              {(selectionError || (message && !['blocked', 'scan-failed'].includes(uploadPhase))) && <FeedbackMessage message={selectionError || message} tone={selectionError || uploadPhase === 'query' ? 'error' : feedbackTone(message)} />}
              {submitting && ['uploading', 'pausing'].includes(uploadPhase) && <button className="secondary-button wide" disabled={uploadPhase === 'pausing'} onClick={pauseSubmit}><Pause size={16} /> {uploadPhase === 'pausing' ? '正在暂停...' : '暂停上传'}</button>}
              {pendingUpload && !submitting && !completionPending && <button className="secondary-button wide" onClick={abandonUpload}><X size={16} /> 放弃本次上传</button>}
              <button className="primary-button wide" onClick={submit} disabled={submitting || uploadPhase === 'blocked' || !files.length || Boolean(selectionError) || !resumeMatches}>{pendingUpload ? <Play size={17} /> : <UploadCloud size={17} />} {submitting ? uploadPhase === 'finalizing' ? '正在完成提交...' : '提交中...' : uploadPhase === 'blocked' ? '风险文件已阻止' : completionPending ? '查询处理结果' : uploadPhase === 'scan-failed' ? '重试安全检查' : pendingUpload ? '继续上传' : '提交文件'}</button>
            </div>
            </div>
          </>
        ) : (
          <>
            <span className="public-icon"><Inbox size={24} /></span>
            <StateBlock title="无法打开收集任务" detail={message || '正在加载任务'} />
          </>
        )}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

export function CollectionManagePage({ token }) {
  const { toast, notify } = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // destroyed 状态已移除：销毁收集任务在记录页完成（DELETE 后管理页 GET 会 404，走 error 分支）
  const [editing, setEditing] = useState(false)
  const [submissionPage, setSubmissionPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const saveManagedCollection = (collection) => {
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
      notify('收集任务设置已保存', 'success')
      return true
    } catch (err) {
      notify(err.message || '收集任务设置保存失败，请重试', 'error')
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
      notify('收集任务已关闭', 'success')
      return true
    } catch (err) {
      notify(err.message || '关闭收集任务失败，请重试', 'error')
      return false
    }
  }

  const reopenTask = async (patch = {}) => {
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, status: 'active' }) })
      saveManagedCollection(result.collection)
      notify('收集任务已重新开启', 'success')
      return true
    } catch (err) {
      notify(err.message || '重新开启收集任务失败，请重试', 'error')
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
      notify('提交记录已删除', 'success')
      return true
    } catch (err) {
      notify(err.message || '删除提交失败，请重试', 'error')
      return false
    }
  }

  const copyPublicValue = (value) => copyTextWithFeedback(value, notify, '提交链接已复制')
  const copyPublicQrImage = (dataUrl, fallbackText) => copyImageWithFeedback(dataUrl, fallbackText, notify)
  const downloadAll = () => startDownload(createCollectionDownloadConfig(data))
  const downloadSubmissionItem = (submission) => startDownload(createSubmissionDownloadConfig(data, submission))
  const downloadFile = (submission, fileIndex) => startDownload(createSubmissionFileDownloadConfig(data, submission, fileIndex))
  const previewFile = (submission, fileIndex) => setPreviewItem(createSubmissionFilePreviewConfig(data, submission, fileIndex))
  const refreshTask = async () => {
    setRefreshing(true)
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`)
      saveManagedCollection(result.collection)
      notify('收集任务已刷新', 'success')
    } catch (err) {
      notify(err.message || '刷新收集任务失败，请重试', 'error')
    } finally {
      setRefreshing(false)
    }
  }
  if (error) return <PublicShell><StateBlock title="管理链接不可用" detail={error} /></PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const isActive = data.status === 'active'
  const submissions = data.submissions || []
  const totalFileCount = submissions.reduce((sum, submission) => sum + (submission.files?.length || 0), 0)
  const usedBytes = Number(data.usedBytes) || 0
  const totalBytes = submissions.reduce((sum, submission) => sum + submission.files.reduce((n, file) => n + (Number(file.size) || 0), 0), 0)
  const allFiles = submissions.flatMap((submission) => submission.files || [])
  const allApproved = allFiles.length > 0 && allFiles.every((file) => file.reviewStatus === 'approved')
  const capacityBytes = Number(data.capacityBytes) || 0
  const capacityPercent = capacityBytes ? Math.min(100, (usedBytes / capacityBytes) * 100) : 0
  const capacityText = capacityBytes
    ? `占收集额度 ${capacityPercent > 0 && capacityPercent < 0.1 ? '<0.1' : capacityPercent.toFixed(1).replace(/\.0$/, '')}%`
    : '已收文件占用'
  const typesText = (data.allowedTypes || []).length ? data.allowedTypes.join(' / ') : '全部格式'
  const sizeText = data.maxFileSizeMb ? `${Math.round(data.maxFileSizeMb)} MB` : '按套餐上限'
  const deadlineText = data.deadline ? formatDate(data.deadline) : '未设置截止时间'
  const remainingText = (() => {
    if (!isActive) return collectionStatusText(data.status, data.deadline)
    if (!data.deadline) return '不限时'
    const diff = new Date(data.deadline).getTime() - Date.now()
    if (diff <= 0) return '已截止'
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    if (days > 0) return `${days} 天 ${hours} 时`
    const minutes = Math.max(1, Math.floor((diff % 3600000) / 60000))
    return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
  })()
  const pageSize = 6
  const pageCount = Math.max(1, Math.ceil(submissions.length / pageSize))
  const safePage = Math.min(submissionPage, pageCount)
  const pageSubmissions = submissions.slice((safePage - 1) * pageSize, safePage * pageSize)
  // 导出清单是客户端根据真实提交生成 CSV，不额外请求服务端。
  // 导出清单：xlsx 而不是 csv —— CSV 无法携带列宽信息，WPS/Excel 打开后日期会被识别成日期值
  // 显示成 ######、手机号账号会变科学计数法，且必须手动调列宽。xlsx 可按内容写入列宽，
  // 所有字段都按文本单元格写入，打开即可读。
  const exportSubmissionsSheet = async () => {
    const XLSX = await import('xlsx')
    const header = ['提交人', '提交账号', '提交时间', '文件数', '文件总大小', '文件名', '文件大小']
    const rows = [header]
    for (const submission of submissions) {
      const size = submission.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
      for (const file of submission.files) {
        rows.push([submission.participantName || '', submission.submitter?.displayName || '', formatDate(submission.submittedAt), submission.files.length, formatBytes(size), file.name, formatBytes(file.size)])
      }
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    // 列宽随内容自适应：中日韩全角字符按 2 个字符宽计算，留 2 字边距，限制在 8~60 之间
    const textWidth = (value) => String(value ?? '').replace(/[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6b\uff00-\uff60\uffe0-\uffe6]/g, '  ').length
    sheet['!cols'] = header.map((title, col) => ({ wch: Math.min(60, Math.max(8, rows.reduce((width, row) => Math.max(width, textWidth(row[col])), textWidth(title)) + 2)) }))
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, '提交清单')
    XLSX.writeFile(book, `${String(data.title || '收集清单').replace(/[\\/:*?"<>|]/g, '_')}.xlsx`)
    notify('已导出提交清单', 'success')
  }
  const manageTarget = { kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data }
  return (
    <PublicShell>
      {toast && <Toast {...toast} />}
      <div className="cm-page">
        <div className="cm-crumb"><a href="/?view=collect">收集文件</a><i>/</i><span>收集管理</span></div>
        <div className="cm-head">
          <div className="cm-head-copy">
            <h1>{data.title}<ProtoBadge tone={isActive ? 'ok' : 'warn'}>{collectionStatusText(data.status, data.deadline)}</ProtoBadge></h1>
            <p>截止 {deadlineText} · 无需登录 · {typesText} ≤ {sizeText}</p>
          </div>
          <div className="cm-head-actions">
            <button type="button" className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 收集设置</button>
            <button type="button" className="secondary-button" disabled={!data.publicUrl} onClick={() => copyPublicValue(data.publicUrl)}><Link2 size={15} /> 提交链接</button>
            <button type="button" className="secondary-button" disabled={refreshing} onClick={refreshTask}><RefreshCw size={15} /> 刷新</button>
          </div>
        </div>
        <div className="cm-stats">
          <div className="cm-stat"><span>提交人数</span><b>{data.participantCount ?? submissions.length}</b><small>{submissions.length} 份提交</small></div>
          <div className="cm-stat"><span>收到文件</span><b>{totalFileCount}</b><small>{allFiles.length ? (allApproved ? '全部通过安全检查' : '含未完成安全检查的文件') : '暂无文件'}</small></div>
          <div className="cm-stat"><span>已用容量</span><b>{formatBytes(usedBytes)}</b><small>{capacityText}</small></div>
          <div className="cm-stat"><span>{isActive ? '剩余时间' : '任务状态'}</span><b>{remainingText}</b><small>{deadlineText} 截止</small></div>
        </div>
        <div className="cm-grid">
          <section className="cm-main" aria-label="已收提交">
            <div className="cm-card">
              <div className="cm-card-head">
                <h2>已收提交</h2>
                <div className="cm-card-actions">
                  <button type="button" className="secondary-button" disabled={!submissions.length || downloadBusy} onClick={downloadAll}><Download size={14} /> 全部下载</button>
                  <button type="button" className="secondary-button" disabled={!submissions.length} onClick={() => { exportSubmissionsSheet().catch(() => notify('导出失败，请稍后重试', 'error')) }}><FileText size={14} /> 导出清单</button>
                </div>
              </div>
              <div className="cm-card-body">
                <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
                {pageSubmissions.length ? pageSubmissions.map((submission) => {
                  const submissionSize = submission.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
                  return (
                    <article className="cm-submission" key={submission.id}>
                      <div className="cm-sub-head">
                        <span className="cm-avatar">{(submission.participantName || '匿').slice(0, 1)}</span>
                        <div className="cm-sub-copy">
                          <b>
                            {submission.participantName || '匿名提交'}
                            {submission.submitter
                              ? <em className="cm-account-tag"><UserRound size={11} /> 账号提交</em>
                              : <em className="cm-anon-tag">匿名提交</em>}
                          </b>
                          <small>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件 · {formatBytes(submissionSize)}</small>
                        </div>
                        <button type="button" className="secondary-button" disabled={downloadBusy} onClick={() => downloadSubmissionItem(submission)}><Download size={14} /> 下载全部</button>
                        <button type="button" className="ghost-icon cm-delete" title="删除提交" aria-label={`删除 ${submission.participantName || '匿名'} 的提交`} onClick={() => deleteSubmission(submission.id)}><Trash2 size={15} /></button>
                      </div>
                      <div className="cm-files">
                        {submission.files.map((file, fileIndex) => (
                          <div className="cm-file-row" key={`${submission.id}-${file.relativePath || file.name}`}>
                            <PrototypeFileIcon name={file.name} fallback={FileText} size={20} />
                            <span title={file.name}>{file.name}</span>
                            <small>{formatBytes(file.size)}</small>
                            <div className="cm-file-actions">
                              {canPreviewFile(file) ? (
                                <button type="button" className="ghost-icon" aria-label={`预览 ${file.name}`} title="预览" onClick={() => previewFile(submission, fileIndex)}><Eye size={15} /></button>
                              ) : (
                                // 不可预览时保留同尺寸占位，避免大小文字与下载按钮左右跳动
                                <span className="ghost-icon cm-action-slot" aria-hidden="true" />
                              )}
                              <button type="button" className="ghost-icon" aria-label={`下载 ${file.name}`} title="下载" disabled={downloadBusy} onClick={() => downloadFile(submission, fileIndex)}><Download size={15} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  )
                }) : (
                  <div className="cm-empty"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
                )}
              </div>
              <div className="cm-card-foot">
                <span>共 {data.participantCount ?? submissions.length} 位提交人 · {totalFileCount} 个文件 · {formatBytes(usedBytes || totalBytes)}</span>
                {pageCount > 1 && (
                  <div className="cm-pager">
                    <button type="button" className="secondary-button" disabled={safePage <= 1} onClick={() => setSubmissionPage(Math.max(1, safePage - 1))}>上一页</button>
                    <span>{safePage} / {pageCount}</span>
                    <button type="button" className="secondary-button" disabled={safePage >= pageCount} onClick={() => setSubmissionPage(Math.min(pageCount, safePage + 1))}>下一页</button>
                  </div>
                )}
              </div>
            </div>
          </section>
          <aside className="cm-aside">
            <div className="cm-card cm-info-card">
              <div className="cm-card-head"><h2>任务信息</h2></div>
              <div className="cm-card-body">
                <dl className="cm-sum">
                  <div><dt>提交链接</dt><dd className="cm-link" title={data.publicUrl}>{data.publicUrl}</dd></div>
                  <div><dt>截止时间</dt><dd>{deadlineText}</dd></div>
                  <div><dt>允许类型</dt><dd>{typesText}</dd></div>
                  <div><dt>单文件上限</dt><dd>{sizeText}</dd></div>
                  <div><dt>提交人身份</dt><dd>无需登录 · 支持匿名提交</dd></div>
                </dl>
                {data.qrDataUrl && <button type="button" className="cm-qr-trigger" onClick={() => setQrOpen(true)} aria-label="放大收集任务二维码"><img className="cm-qr" src={data.qrDataUrl} alt="收集任务二维码" /></button>}
                <p className="cm-qr-note">扫码提交材料</p>
              </div>
            </div>
            {isActive ? (
              <div className="cm-danger">
                <h3><AlertTriangle size={15} /> 关闭收集</h3>
                <p>关闭后提交链接立即失效，已收到的文件仍会保留。</p>
                <button type="button" className="cm-danger-button" onClick={closeTask}>立即关闭</button>
              </div>
            ) : (
              <div className="cm-closed-card">
                <h3><Clock3 size={15} /> 任务{collectionStatusText(data.status, data.deadline)}</h3>
                <p>提交链接当前不可用；已收到的文件仍保留在上方，可随时下载。</p>
                {canReopenCollection(data) ? (
                  <button type="button" className="secondary-button" onClick={() => reopenTask()}><RefreshCw size={15} /> 重新开启任务</button>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => setEditing(true)}><CalendarDays size={15} /> 延长后开启</button>
                )}
              </div>
            )}
          </aside>
        </div>
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startDownload(config || previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
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
