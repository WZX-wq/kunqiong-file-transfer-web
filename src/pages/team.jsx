import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, copyTextToClipboard, createUploadSessionState, createUploadState } from '../lib/api.js'
import { useConfirmDialog, useDownloadTask } from '../hooks.js'
import { canPreviewFile, createShareDownloadConfig, createShareFilePreviewConfig, uploadShareInChunks } from '../lib/transfer.js'
import { createShareRecord, saveLocalRecord, upsertCloudRecords } from '../lib/records.js'
import { ConfirmModal, PublicShell } from '../components/common.jsx'
import { ArrowLeft, Check, ClipboardCheck, Copy, Crown, Database, Download, Eye, FileText, HardDrive, Link2, LogOut, Search, Settings2, Trash2, UploadCloud, UserPlus, UserRound, Users, X } from 'lucide-react'
import { formatBytes, formatDate } from '../lib/format.js'
import { AdminPagination } from './AdminPage.jsx'
import { DownloadProgressPanel, FilePreviewModal, RecordPreviewChooser } from '../components/ui.jsx'

export function TeamPage() {
  const [user, setUser] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [memberTarget, setMemberTarget] = useState('')
  const [memberSuggestions, setMemberSuggestions] = useState([])
  const [savingMember, setSavingMember] = useState(false)
  const [activeTab, setActiveTab] = useState('members')
  const [memberQuery, setMemberQuery] = useState('')
  const [manageMemberQuery, setManageMemberQuery] = useState('')
  const [resourceQuery, setResourceQuery] = useState('')
  const [teamFiles, setTeamFiles] = useState([])
  const [teamUploadState, setTeamUploadState] = useState(createUploadState())
  const [teamUploading, setTeamUploading] = useState(false)
  const teamUploadInputRef = useRef(null)
  const teamUploadRef = useRef(createUploadSessionState())
  const [memberUsagePage, setMemberUsagePage] = useState(1)
  const [teamResourcePage, setTeamResourcePage] = useState(1)
  const [teamMemberPage, setTeamMemberPage] = useState(1)
  const [decidingRequestId, setDecidingRequestId] = useState('')
  const [leavingTeam, setLeavingTeam] = useState(false)
  const [dissolvingTeam, setDissolvingTeam] = useState(false)
  // 成员没有管理权限，若状态残留在「团队成员 / 入团申请」页签会看到空白面板，统一回落到「成员观察」
  const visibleTab = data?.canManage || (activeTab !== 'manage' && activeTab !== 'requests') ? activeTab : 'members'
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()
  const [previewItem, setPreviewItem] = useState(null)
  // 团队资源可能是「多文件分享」，预览按钮不能只盯着 files[0]：
  // 多文件时先让用户选要预览哪一个（复用记录页的 RecordPreviewChooser）。
  const [previewChoices, setPreviewChoices] = useState(null)
  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const auth = await apiRequest('/api/auth/me')
      if (!auth.user) {
        setUser(null)
        return
      }
      setUser(auth.user)
      setData(await apiRequest('/api/account/team/overview'))
    } catch (err) {
      if (silent) setNotice({ message: err.message || '团队数据刷新失败', tone: 'error' })
      else setError(err.message || '团队数据加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    setMemberUsagePage(1)
    setTeamResourcePage(1)
    setTeamMemberPage(1)
  }, [data?.memberUsage?.length, data?.resources?.length, memberQuery, manageMemberQuery, resourceQuery])
  useEffect(() => {
    if (!data?.canManage || !memberTarget.trim()) {
      setMemberSuggestions([])
      return undefined
    }
    const timer = window.setTimeout(() => {
      apiRequest(`/api/account/workspace/member-search?q=${encodeURIComponent(memberTarget.trim())}`)
        .then((result) => setMemberSuggestions(result.users || []))
        .catch(() => setMemberSuggestions([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [data?.canManage, memberTarget])

  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }
  const goWorkspace = () => { window.location.href = '/workspace' }
  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/workspace'
  }
  const inviteMember = async (event) => {
    event.preventDefault()
    if (!memberTarget.trim() || !data?.canManage) return
    setSavingMember(true)
    setError('')
    try {
      await apiRequest('/api/account/workspace/members', { method: 'POST', body: JSON.stringify({ target: memberTarget.trim() }) })
      setMemberTarget('')
      setMemberSuggestions([])
      await load()
    } catch (err) {
      setNotice({ message: err.message || '成员邀请失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }
  const removeMember = async (member) => {
    if (!data?.canManage || !member?.id || member.role === 'owner') return
    const memberName = member.displayName || member.email || member.phone || '该成员'
    const confirmed = await requestConfirm({
      eyebrow: '团队成员管理',
      title: `移除「${memberName}」`,
      detail: member.status === 'invited'
        ? '移除后，该账号将无法再通过此前收到的邀请加入团队空间。此操作不可撤销，确定继续吗？'
        : `移除后，该成员将无法继续访问“${organization?.name || '团队空间'}”内的共享文件，账号权益也会一并回收。此操作不可撤销，确定继续吗？`,
      confirmText: '确认移除',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    setSavingMember(true)
    setError('')
    try {
      const result = await apiRequest(`/api/account/workspace/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' })
      await load()
      setNotice({
        message: member.status === 'invited'
          ? `已移除待加入成员「${memberName}」。`
          : `已移除成员「${memberName}」，站内通知已发送。`,
        tone: 'success',
      })
      return result
    } catch (err) {
      setNotice({ message: err.message || '成员移除失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }

  // 转让团队所有权：指定正式成员接管，自己降级为普通成员（此后可退出团队空间）。
  const transferOwnership = async (member) => {
    if (!data?.canManage || !member?.id || member.role === 'owner') return
    const memberName = member.displayName || member.email || member.phone || '该成员'
    const confirmed = await requestConfirm({
      eyebrow: '转让团队所有权',
      title: `将团队转让给「${memberName}」`,
      detail: `转让后，「${memberName}」将成为团队所有者，负责成员管理、审批与容量；你将变为普通成员，之后可随时退出团队空间。若对方套餐不含团队版权益，团队空间功能会停用。此操作不可撤销，确定继续吗？`,
      confirmText: '确认转让',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    setSavingMember(true)
    setError('')
    try {
      const result = await apiRequest('/api/account/workspace/transfer-ownership', { method: 'POST', body: JSON.stringify({ targetMemberId: member.id }) })
      await load()
      setNotice({ message: `团队所有权已转让给「${result?.nextOwnerName || memberName}」，你现在是团队成员。`, tone: 'success' })
    } catch (err) {
      setNotice({ message: err.message || '团队转让失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }

  // 解散团队：最高危操作，全员立即失去团队空间访问权（个人数据不受影响）。
  const dissolveTeam = async () => {
    if (!data?.canManage || dissolvingTeam) return
    const memberCount = (data.organization?.members || []).filter((item) => item.status === 'active').length
    const firstConfirmed = await requestConfirm({
      eyebrow: '解散团队',
      title: `解散「${organization?.name || '团队空间'}」`,
      detail: `解散后，全部 ${memberCount} 位成员将立即失去团队空间访问权，团队的分享、收集与专属链接一并停止。所有成员的个人文件、空间容量与套餐权益不受影响。此操作不可撤销。`,
      confirmText: '下一步',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!firstConfirmed) return
    const finalConfirmed = await requestConfirm({
      eyebrow: '解散团队 · 最终确认',
      title: '真的要解散这个团队吗？',
      detail: '解散后团队无法恢复，成员需要重新组建团队并重新邀请才能再次协作。请再次确认。',
      confirmText: '确认解散',
      cancelText: '再想想',
      tone: 'danger',
    })
    if (!finalConfirmed) return
    setDissolvingTeam(true)
    setError('')
    try {
      const result = await apiRequest('/api/account/workspace/dissolve', { method: 'POST' })
      setNotice({ message: `已解散“${organization?.name || '团队空间'}”${result?.notifiedCount ? `，${result.notifiedCount} 位成员已收到通知` : ''}。`, tone: 'success' })
      window.location.href = '/workspace'
    } catch (err) {
      setNotice({ message: err.message || '团队解散失败', tone: 'error' })
    } finally {
      setDissolvingTeam(false)
    }
  }

  // 成员主动退出团队空间。退出的是"团队协作关系"，个人套餐与个人空间不受影响。
  const leaveTeam = async () => {
    if (leavingTeam) return
    const confirmed = await requestConfirm({
      eyebrow: '退出团队空间',
      title: `退出「${organization?.name || '团队空间'}」`,
      detail: '退出后，你将无法继续访问该团队空间内的共享文件与专属链接，团队所有者会收到通知。你个人的文件、空间容量与套餐权益不受任何影响，之后仍可通过邀请重新加入。确定退出吗？',
      confirmText: '确认退出',
      cancelText: '再想想',
      tone: 'danger',
    })
    if (!confirmed) return
    setLeavingTeam(true)
    setError('')
    try {
      await apiRequest('/api/account/workspace/leave', { method: 'POST' })
      setNotice({ message: `已退出“${organization?.name || '团队空间'}”，你的个人空间与套餐不受影响。`, tone: 'success' })
      await load()
    } catch (err) {
      setNotice({ message: err.message || '退出团队失败', tone: 'error' })
    } finally {
      setLeavingTeam(false)
    }
  }

  const reviewJoinRequest = async (request, decision) => {
    if (!data?.canManage || !request?.requestId || decidingRequestId) return
    const applicantName = request.displayName || request.email || request.phone || '该账号'
    const approved = decision === 'approve'
    const confirmed = await requestConfirm({
      eyebrow: '入团申请审批',
      title: approved ? `同意「${applicantName}」加入` : `拒绝「${applicantName}」的申请`,
      detail: approved
        ? `同意后，${applicantName} 将成为“${organization?.name || '团队空间'}”的正式成员，可访问团队共享文件并占用团队容量。确定同意吗？`
        : `拒绝后，${applicantName} 将收到站内通知，并在 24 小时内无法再次申请。确定拒绝吗？`,
      confirmText: approved ? '同意加入' : '拒绝申请',
      cancelText: '取消',
      tone: approved ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setDecidingRequestId(request.requestId)
    setError('')
    try {
      const result = await apiRequest(`/api/account/workspace/join-requests/${encodeURIComponent(request.requestId)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      setData((current) => (current ? { ...current, joinRequests: result.joinRequests || [] } : current))
      await load({ silent: true })
      setNotice({ message: approved ? `已同意「${applicantName}」加入团队空间。` : `已拒绝「${applicantName}」的入团申请。`, tone: 'success' })
    } catch (err) {
      setNotice({ message: err.message || '入团申请审批失败', tone: 'error' })
    } finally {
      setDecidingRequestId('')
    }
  }

  const addTeamFiles = (incoming) => {
    const nextFiles = Array.from(incoming || []).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      relativePath: file.webkitRelativePath || file.name,
    }))
    if (!nextFiles.length) return
    const names = new Set()
    const duplicate = nextFiles.find((file) => {
      const normalized = file.name.trim().toLowerCase()
      if (names.has(normalized)) return true
      names.add(normalized)
      return false
    })
    if (duplicate) {
      setNotice({ message: `团队空间已存在同名文件“${duplicate.name}”，请修改文件名后再上传。`, tone: 'error' })
      return
    }
    setTeamFiles(nextFiles)
    setTeamUploadState(createUploadState())
    teamUploadRef.current = createUploadSessionState()
    setError('')
  }

  const uploadTeamFiles = async () => {
    if (!teamFiles.length || teamUploading) return
    const uploadCount = teamFiles.length
    setTeamUploading(true)
    setNotice(null)
    try {
      const result = await uploadShareInChunks(
        teamFiles,
        { expiryDays: '0', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '' },
        teamUploadRef,
        ({ progress, ...nextState }) => setTeamUploadState((current) => ({ ...current, ...nextState, progress })),
        { sessionBody: { mode: 'team_resource' } },
      )
      if (result?.share) {
        const record = createShareRecord(result.share, 'my_sent')
        saveLocalRecord(record)
        upsertCloudRecords([record]).catch(() => {})
      }
      setTeamFiles([])
      teamUploadRef.current = createUploadSessionState()
      setTeamUploadState(createUploadState())
      await load({ silent: true })
      setNotice({ message: `已成功上传 ${uploadCount} 个文件到团队空间。`, tone: 'success' })
    } catch (err) {
      setTeamUploadState((current) => ({ ...current, status: 'failed', phase: '上传失败', error: err.message }))
      setNotice({ message: err.message || '团队文件上传失败', tone: 'error' })
    } finally {
      setTeamUploading(false)
    }
  }

  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开团队管理</h1><p>正在读取团队成员和资源使用情况。</p></div></PublicShell>
  if (!user) return <PublicShell><div className="state-block"><div className="settings-state-icon"><Users size={24} /></div><h1>登录后查看团队</h1><p>团队成员、容量和资源使用情况会与鲲穹账号关联。</p><button className="primary-button" onClick={login}><UserRound size={16} /> 使用鲲穹登录</button></div></PublicShell>
  if (error || !data) return <PublicShell><div className="state-block"><div className="settings-state-icon"><Users size={24} /></div><h1>暂未加入团队空间</h1><p>{error || '接受团队邀请后，可以在这里查看团队使用情况。'}</p><button className="secondary-button" onClick={goWorkspace}><ArrowLeft size={15} /> 返回会员与团队空间</button></div></PublicShell>

  const organization = data.organization || {}
  const capacity = data.capacity || {}
  const members = data.memberUsage || []
  const resources = data.resources || []
  const joinRequests = data.joinRequests || []
  const memberName = (userId) => members.find((item) => item.userId === userId)?.displayName || '团队成员'
  // 团队邀请链接：与工作台使用的是同一个企业专属入口。
  const teamInviteLink = organization.slug ? `${window.location.origin}/e/${organization.slug}/share/` : ''
  const copyTeamInviteLink = async () => {
    setNotice(null)
    try {
      await copyTextToClipboard(teamInviteLink)
      setNotice({ message: '团队邀请链接已复制，发给同事即可申请加入', tone: 'success' })
    } catch {
      setNotice({ message: '当前浏览器不支持自动复制，请手动选中链接复制', tone: 'error' })
    }
  }
  const normalizedMemberQuery = memberQuery.trim().toLowerCase()
  const normalizedManageMemberQuery = manageMemberQuery.trim().toLowerCase()
  const normalizedResourceQuery = resourceQuery.trim().toLowerCase()
  const filteredMembers = normalizedMemberQuery
    ? members.filter((member) => [member.displayName, member.email, member.phone, member.userId].some((value) => String(value || '').toLowerCase().includes(normalizedMemberQuery)))
    : members
  const filteredManageMembers = normalizedManageMemberQuery
    ? members.filter((member) => [member.displayName, member.email, member.phone, member.userId].some((value) => String(value || '').toLowerCase().includes(normalizedManageMemberQuery)))
    : members
  const filteredResources = normalizedResourceQuery
    ? resources.filter((resource) => [resource.name, memberName(resource.ownerUserId)].some((value) => String(value || '').toLowerCase().includes(normalizedResourceQuery)))
    : resources
  const totalBytes = Number(capacity.totalBytes || 0)
  const usedBytes = Number(capacity.usedBytes || 0)
  const ratio = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
  const statusLabel = (status) => status === 'active' ? '进行中' : status === 'expired' ? '已过期' : status === 'closed' ? '已关闭' : status
  const teamPageSize = 8
  const memberUsagePageCount = Math.max(1, Math.ceil(filteredMembers.length / teamPageSize))
  const teamResourcePageCount = Math.max(1, Math.ceil(filteredResources.length / teamPageSize))
  const teamMemberPageCount = Math.max(1, Math.ceil(filteredManageMembers.length / teamPageSize))
  const safeMemberUsagePage = Math.min(memberUsagePage, memberUsagePageCount)
  const safeTeamResourcePage = Math.min(teamResourcePage, teamResourcePageCount)
  const safeTeamMemberPage = Math.min(teamMemberPage, teamMemberPageCount)
  const visibleMemberUsage = filteredMembers.slice((safeMemberUsagePage - 1) * teamPageSize, safeMemberUsagePage * teamPageSize)
  const visibleTeamResources = filteredResources.slice((safeTeamResourcePage - 1) * teamPageSize, safeTeamResourcePage * teamPageSize)
  const visibleTeamMembers = filteredManageMembers.slice((safeTeamMemberPage - 1) * teamPageSize, safeTeamMemberPage * teamPageSize)
  const downloadResource = (resource) => startDownload(createShareDownloadConfig(resource))
  // 团队资源预览：把资源的每个可预览文件都做成候选。
  // - 只有 1 个可预览文件 → 直接打开
  // - 多个可预览文件     → 弹选择器让用户挑选（与「记录」页交互一致）
  // 之前这里只取 files[0] 且要求 files.length === 1，导致多文件资源的预览按钮
  // 被永久禁用（配合 .ghost-icon:disabled 的 cursor:wait，看起来像一直转圈）。
  const previewResource = (resource) => {
    const files = Array.isArray(resource.files) ? resource.files : []
    const previews = files
      .map((file, index) => (canPreviewFile(file) ? { ...createShareFilePreviewConfig(resource, file, index), key: `${resource.id}:${index}` } : null))
      .filter(Boolean)
    if (previews.length === 1) {
      setPreviewItem(previews[0])
      return
    }
    if (previews.length > 1) setPreviewChoices(previews)
  }
  // 该资源是否有任何可预览文件（决定按钮可用性）
  const resourcePreviewable = (resource) => Array.isArray(resource.files) && resource.files.some((file) => canPreviewFile(file))
  // 关闭分享只切断公开提取链接：所有者仍可打开自己的资源，其他成员按钮禁用并提示。
  const resourceLockedForViewer = (resource) => resource.status === 'closed' && resource.ownerUserId !== user.id
  // 编辑权 = 资源所有者本人 或 团队空间所有者（后端按同规则下发 manageUrl）
  const resourceEditAllowed = (resource) => Boolean(resource.manageUrl) && (resource.ownerUserId === user.id || data.canManage)

  return <PublicShell>
    <section className="team-page">
      <div className="team-page-heading"><div><p className="eyebrow">团队空间</p><h1>{organization.name}</h1><p>统一查看成员使用量、团队资源和空间状态。</p></div><div className="team-page-actions"><button className="secondary-button" onClick={goBack}><ArrowLeft size={15} /> 返回</button></div></div>
      {!data.canManage && <div className="public-card team-panel team-leave-card">
        <div className="team-leave-body">
          <LogOut size={17} />
          <div>
            <strong>你正在共享「{organization.name}」的团队空间</strong>
            <span>团队容量由团队所有者提供，你个人的文件与空间容量不受影响。如果你想结束共享，可以随时退出该团队。</span>
          </div>
        </div>
        <button type="button" className="secondary-button danger-lite team-leave-button" onClick={leaveTeam} disabled={leavingTeam}>
          <LogOut size={14} /> {leavingTeam ? '正在退出' : '退出团队空间'}
        </button>
      </div>}
      {data.canManage && teamInviteLink && <div className="public-card team-panel team-invite-link-card">
        <div className="team-invite-link-head"><Link2 size={16} /><div><strong>团队邀请链接</strong><small>发给同事，对方登录后可在页面底部直接申请加入，申请会出现在「入团申请」里由你审批。</small></div></div>
        <div className="team-invite-link-row">
          <code title={teamInviteLink}>{teamInviteLink}</code>
          <button type="button" className="copy-button" onClick={copyTeamInviteLink}><Copy size={14} /> 复制链接</button>
        </div>
      </div>}
      <div className="team-kpi-grid"><div className="team-kpi"><span><Users size={16} /> 成员</span><strong>{members.filter((item) => item.status !== 'invited').length}</strong><small>{members.filter((item) => item.status === 'invited').length} 个待加入</small></div><div className="team-kpi"><span><HardDrive size={16} /> 已使用空间</span><strong>{formatBytes(usedBytes)}</strong><small>共 {formatBytes(totalBytes)}</small></div><div className="team-kpi"><span><Database size={16} /> 文件资源</span><strong>{resources.reduce((sum, item) => sum + item.fileCount, 0)}</strong><small>{resources.length} 个分享或收集任务</small></div><div className="team-kpi"><span><Link2 size={16} /> 活跃资源</span><strong>{resources.filter((item) => item.status === 'active').length}</strong><small>{data.canManage ? '你是团队所有者' : '团队成员视图'}</small></div></div>
      <div className="team-overview-grid">
        <div className="public-card team-panel team-capacity-panel"><div className="team-panel-heading"><div><p className="eyebrow">空间使用</p><h2>团队容量</h2></div><span className="workspace-status">{ratio}%</span></div><div className="team-capacity-number"><strong>{formatBytes(usedBytes)}</strong><span>/ {formatBytes(totalBytes)}</span></div><div className="capacity-bar"><span style={{ width: `${ratio}%` }} /></div><div className="team-capacity-meta"><span>{capacity.shareCount || 0} 个分享</span><span>{capacity.collectionCount || 0} 个收集任务</span><span>{capacity.fileCount || 0} 个文件</span></div></div>
      </div>
      <div className="team-tabs-shell">
        <div className="team-tabs" role="tablist" aria-label="团队详情">
          <button className={activeTab === 'members' ? 'active' : ''} role="tab" aria-selected={activeTab === 'members'} onClick={() => setActiveTab('members')}><Users size={15} /> 成员观察</button>
          <button className={activeTab === 'resources' ? 'active' : ''} role="tab" aria-selected={activeTab === 'resources'} onClick={() => setActiveTab('resources')}><Database size={15} /> 团队资源 <span>{resources.length}</span></button>
          {data.canManage && <button className={activeTab === 'manage' ? 'active' : ''} role="tab" aria-selected={activeTab === 'manage'} onClick={() => setActiveTab('manage')}><UserPlus size={15} /> 团队成员 <span>{members.length}</span></button>}
          {data.canManage && <button className={activeTab === 'requests' ? 'active' : ''} role="tab" aria-selected={activeTab === 'requests'} onClick={() => setActiveTab('requests')}><ClipboardCheck size={15} /> 入团申请 <span>{joinRequests.length}</span></button>}
        </div>
        {visibleTab === 'members' && <div className="public-card team-panel team-tab-panel"><div className="team-panel-heading"><div><p className="eyebrow">成员观察</p><h2>成员使用量</h2></div><span>{filteredMembers.length} / {members.length} 位成员</span></div>{data.canManage && <div className="team-invite-wrap"><form className="team-invite-form" onSubmit={inviteMember}><label className="team-invite-input"><Search size={15} /><input value={memberTarget} onChange={(event) => setMemberTarget(event.target.value)} placeholder="输入邮箱、手机号或鲲穹账号，直接邀请成员" disabled={savingMember} /></label><button className="primary-button" disabled={savingMember || !memberTarget.trim()}><UserPlus size={14} /> 邀请</button></form>{memberSuggestions.length > 0 && <div className="team-suggestions">{memberSuggestions.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setMemberTarget(candidate.email || candidate.phone || candidate.username || candidate.id); setMemberSuggestions([]) }}><span className="workspace-member-avatar">{(candidate.displayName || '成').slice(0, 1)}</span><span><strong>{candidate.displayName || candidate.username || candidate.id}</strong><small>{candidate.username || candidate.email || candidate.phone || candidate.id}</small></span></button>)}</div>}</div>}<label className="team-search"><Search size={15} /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="检索成员姓名、账号、手机号或邮箱" /></label><div className="team-member-usage">{visibleMemberUsage.map((member) => { const memberBytes = Math.max(0, Number(member.usedBytes) || 0); const memberShare = usedBytes > 0 ? Math.min(100, Math.max(0, (memberBytes / usedBytes) * 100)) : 0; const hasUsage = memberBytes > 0; return <div className="team-member-usage-row" key={member.id}><span className="workspace-member-avatar">{(member.displayName || '团').slice(0, 1)}</span><div><div className="team-usage-line"><strong>{member.displayName || '待加入成员'}</strong><small>{member.role === 'owner' ? '所有者' : member.status === 'invited' ? '待加入' : '成员'} · {member.fileCount} 个文件</small></div><div className={`team-usage-bar ${hasUsage ? '' : 'is-empty'}`} title={hasUsage ? `占团队已用空间 ${memberShare.toFixed(memberShare < 1 ? 2 : 1)}%` : '暂未占用团队空间'} role="progressbar" aria-valuenow={Number(memberShare.toFixed(1))} aria-valuemin="0" aria-valuemax="100" aria-label={`${member.displayName || '待加入成员'}空间占用`}><i style={{ width: `${hasUsage ? Math.max(memberShare, 1.5) : 0}%` }} /></div></div><span className="team-usage-value"><b>{formatBytes(memberBytes)}</b><em>{hasUsage ? `${memberShare.toFixed(memberShare < 1 ? 2 : 1)}%` : '未使用'}</em></span></div> })}</div>{!filteredMembers.length && <div className="empty-manage"><Search size={25} /><span>没有匹配的成员</span></div>}<AdminPagination page={safeMemberUsagePage} pageCount={memberUsagePageCount} total={filteredMembers.length} pageSize={teamPageSize} onPageChange={setMemberUsagePage} /></div>}
        {visibleTab === 'resources' && <div className="public-card team-panel team-tab-panel"><div className="team-panel-heading"><div><p className="eyebrow">团队资源</p><h2>专属团队文件</h2></div><span>{filteredResources.length} / {resources.length} 个文件</span></div><div className="team-resource-toolbar"><label className="team-search"><Search size={15} /><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="检索文件名或上传成员" /></label><input ref={teamUploadInputRef} type="file" multiple hidden onChange={(event) => { addTeamFiles(event.target.files); event.target.value = '' }} />{data.organization?.members?.some((member) => member.userId === user.id && member.status === 'active') && <button type="button" className="primary-button" onClick={() => teamUploadInputRef.current?.click()} disabled={teamUploading}><UploadCloud size={15} /> 上传到团队空间</button>}</div>{teamFiles.length > 0 && <div className="team-upload-draft"><div><strong>待上传 {teamFiles.length} 个文件</strong><span>{formatBytes(teamFiles.reduce((sum, file) => sum + file.size, 0))} · 同名文件会被拒绝</span></div><div><button type="button" className="primary-button" onClick={uploadTeamFiles} disabled={teamUploading}><UploadCloud size={14} /> {teamUploading ? '上传中' : '开始上传'}</button><button type="button" className="ghost-icon" onClick={() => setTeamFiles([])} aria-label="清除待上传文件" title="清除待上传文件"><X size={15} /></button></div></div>}{teamUploadState.status !== 'idle' && <div className="team-upload-progress"><div><span>{teamUploadState.phase || '上传处理中'}</span><b>{teamUploadState.progress || 0}%</b></div><div className="capacity-bar"><span style={{ width: `${teamUploadState.progress || 0}%` }} /></div></div>}<div className="team-resource-table">{filteredResources.length ? visibleTeamResources.map((resource) => <div className="team-resource-row" key={`${resource.kind}-${resource.id}`}><span className="team-resource-icon"><FileText size={15} /></span><div><strong>{resource.name}</strong><small>{memberName(resource.ownerUserId)} · {resource.fileCount} 个文件</small></div><span className={`team-resource-status ${resource.status}`}>{statusLabel(resource.status, resource.closeReason)}</span><small className="team-resource-size">{formatBytes(resource.totalSize)}</small><div className="team-resource-actions"><button className={`ghost-icon${resourcePreviewable(resource) && !resourceLockedForViewer(resource) ? '' : ' icon-inapplicable'}`} type="button" onClick={() => previewResource(resource)} disabled={!resourcePreviewable(resource) || resourceLockedForViewer(resource)} aria-label={`预览 ${resource.name}`} title={resourceLockedForViewer(resource) ? '分享已关闭，仅资源所有者可访问' : (resourcePreviewable(resource) ? (resource.files.length === 1 ? '预览文件' : `选择要预览的文件（共 ${resource.files.length} 个）`) : '该资源没有可在线预览的文件')}><Eye size={15} /></button><button className="ghost-icon" type="button" onClick={() => downloadResource(resource)} disabled={downloadBusy || resourceLockedForViewer(resource)} aria-label={`下载 ${resource.name}`} title={resourceLockedForViewer(resource) ? '分享已关闭，仅资源所有者可访问' : '下载文件'}><Download size={15} /></button><button className="ghost-icon" type="button" onClick={() => { if (!resourceEditAllowed(resource)) { setNotice({ message: '仅资源所有者或团队所有者可以编辑该团队资源', tone: 'error' }); return } window.open(resource.manageUrl, '_blank', 'noopener,noreferrer') }} aria-label={`管理 ${resource.name}`} title={resourceEditAllowed(resource) ? '编辑团队资源' : '仅资源所有者或团队所有者可以编辑'}><Settings2 size={15} /></button></div></div>) : <div className="empty-manage"><Database size={25} /><span>{resourceQuery ? '没有匹配的团队文件' : '暂无团队文件，请从专属入口上传'}</span></div>}</div><AdminPagination page={safeTeamResourcePage} pageCount={teamResourcePageCount} total={filteredResources.length} pageSize={teamPageSize} onPageChange={setTeamResourcePage} /></div>}
        {visibleTab === 'manage' && data.canManage && <div className="public-card team-panel team-tab-panel team-members-panel"><div className="team-panel-heading"><div><p className="eyebrow">团队成员</p><h2>成员权限</h2></div><span>{filteredManageMembers.length} / {members.length} 位成员</span></div><label className="team-search team-management-search"><Search size={15} /><input value={manageMemberQuery} onChange={(event) => setManageMemberQuery(event.target.value)} placeholder="检索成员姓名、账号、手机号或邮箱" /></label><div className="team-management-list">{visibleTeamMembers.map((member) => <div className="team-management-row" key={member.id}><span className="workspace-member-avatar">{(member.displayName || '团').slice(0, 1)}</span><div><strong>{member.displayName || '待加入成员'}</strong><small>{member.role === 'owner' ? '所有者' : member.status === 'invited' ? '待加入' : '成员'}</small></div><span className={`workspace-member-state ${member.status === 'invited' ? 'pending' : 'active'}`}>{member.status === 'invited' ? '待加入' : member.role === 'owner' ? '所有者' : '已加入'}</span>{data.canManage && member.role !== 'owner' && <div className="team-management-actions">{member.status === 'active' && <button className="ghost-icon" type="button" onClick={() => transferOwnership(member)} disabled={savingMember} aria-label={`转让给${member.displayName || '成员'}`} title="转让所有权给该成员"><Crown size={15} /></button>}<button className="ghost-icon" type="button" onClick={() => removeMember(member)} disabled={savingMember} aria-label={`移除${member.displayName || '成员'}`} title="移除成员"><X size={15} /></button></div>}</div>)}</div>{!filteredManageMembers.length && <div className="empty-manage"><Search size={25} /><span>没有匹配的团队成员</span></div>}<AdminPagination page={safeTeamMemberPage} pageCount={teamMemberPageCount} total={filteredManageMembers.length} pageSize={teamPageSize} onPageChange={setTeamMemberPage} /><div className="team-danger-zone"><div><strong>解散团队</strong><small>解散后全部成员立即失去团队空间访问权，团队无法恢复。各成员的个人文件与套餐权益不受影响。</small></div><button type="button" className="team-dissolve-button" onClick={dissolveTeam} disabled={dissolvingTeam}><Trash2 size={14} /> {dissolvingTeam ? '解散中…' : '解散团队'}</button></div></div>}
        {visibleTab === 'requests' && data.canManage && <div className="public-card team-panel team-tab-panel team-requests-panel">
          <div className="team-panel-heading"><div><p className="eyebrow">入团申请</p><h2>待处理申请</h2></div><span>{joinRequests.length} 条待处理</span></div>
          <p className="team-requests-hint">成员通过团队的企业专属分享链接提交申请，同意后立即成为正式成员，拒绝后 24 小时内不可再次申请。</p>
          {joinRequests.length ? <div className="team-request-list">{joinRequests.map((request) => <div className="team-request-row" key={request.requestId}>
            <span className="workspace-member-avatar">{(request.displayName || '申').slice(0, 1)}</span>
            <div className="team-request-info">
              <strong>{request.displayName || '待审批申请人'}</strong>
              <small>{request.email || request.phone || request.userId}</small>
              {request.message && <em>申请留言：{request.message}</em>}
            </div>
            <span className="team-request-time">{request.requestedAt ? formatDate(request.requestedAt) : '刚刚提交'}</span>
            <div className="team-request-actions">
              <button type="button" className="primary-button" onClick={() => reviewJoinRequest(request, 'approve')} disabled={Boolean(decidingRequestId)}><Check size={14} /> 同意</button>
              <button type="button" className="secondary-button danger-lite" onClick={() => reviewJoinRequest(request, 'reject')} disabled={Boolean(decidingRequestId)}><X size={14} /> 拒绝</button>
            </div>
          </div>)}</div> : <div className="empty-manage"><ClipboardCheck size={25} /><span>当前没有待处理的入团申请</span></div>}
        </div>}
      </div>
    </section>
    {notice && <div className={`toast ${notice.tone || 'success'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span className="toast-icon">{notice.tone === 'error' ? <X size={18} /> : <Check size={18} />}</span><span>{notice.message}</span></div>}
    {previewChoices && <RecordPreviewChooser previews={previewChoices} onClose={() => setPreviewChoices(null)} onSelect={(preview) => setPreviewItem(preview)} />}
    {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
    {/* 下载进度与上方团队卡片同宽：包一层受限宽容器，避免被 .public-page 的居中网格压缩。 */}
    <div className="team-page team-download-slot"><DownloadProgressPanel task={downloadTask} onRetry={retryDownload} /></div>
    <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
  </PublicShell>
}
