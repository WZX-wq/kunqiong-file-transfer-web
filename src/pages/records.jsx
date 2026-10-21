import React from 'react'
import { createPortal } from 'react-dom'
import { canReopenCollection, fileCategoryIcon, isDateInputStillOpen, managedFileItemsFromRecords, matchesManagedFileCategory, matchesManagedFileSearch, matchesRecordDate, matchesRecordScope, matchesRecordStatus, normalizeRecord, recordCopyLabel, recordCopyTarget, recordDetail, recordDisplayName, recordDisplayStatus, recordExpiryLabel, recordIconForScope, recordLink, recordManageUrl, recordOpenLabel, recordScopeLabel, recordStatusGroup, toDateInputValue } from '../lib/records.js'
import { useEffect, useState } from 'react'
import { defaultDeadline, formatBytes, formatDate, isClosedStatus } from '../lib/format.js'
import { Archive, ArrowLeft, CalendarDays, Check, Code2, Copy, Download, ExternalLink, Eye, FileQuestion, FileText, Filter, HardDrive, History, Image as ImageIcon, Inbox, Layers3, Link2, MoreHorizontal, Music2, PencilLine, QrCode, RefreshCw, RotateCcw, Search, Settings2, Trash2, Upload, Video, X } from 'lucide-react'
import { DatePicker, FileFormatBadge, FilePreviewModal, QrPreviewModal, RecordNameText, RecordPreviewChooser, RenameRecordModal } from '../components/ui.jsx'
import { PrototypeAsset, PrototypeFileIcon } from '../components/prototype-asset.jsx'
import { useDownloadTask } from '../hooks.js'
import { FILE_CATEGORY_FILTERS, RECORD_DATE_FILTERS, RECORD_SCOPE_TABS, RECORD_STATUS_FILTERS, RECORD_VIEW_MODES } from '../lib/constants.js'
import { recordPreviewConfigs } from '../lib/transfer.js'
import QRCode from 'qrcode'
import { AdminPagination } from './AdminPage.jsx'

const FILE_CATEGORY_ICONS = {
  all: Layers3,
  image: ImageIcon,
  document: FileText,
  video: Video,
  audio: Music2,
  archive: Archive,
  code: Code2,
  collection: Inbox,
  mixed: Layers3,
  other: FileQuestion,
}

export function ShareExpiryModal({ record, canUsePermanent, onClose, onSave }) {
  const currentExpiry = toDateInputValue(record?.expiresAt)
  const [mode, setMode] = useState('date')
  const [expiryDate, setExpiryDate] = useState(currentExpiry && isDateInputStillOpen(currentExpiry) ? currentExpiry : defaultDeadline(7))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = async () => {
    // 自定义截止日期是会员特权（hasMembership 口径），只有「永久保存」才要求企业版 permanent。
    // 此前误在入口处一刀切 !canUsePermanent 直接 return，导致非企业版用户点保存无任何反馈。
    if (mode === 'permanent' && !canUsePermanent) {
      setError('永久保存需要企业版权益，可选择自定义截止日期')
      return
    }
    if (mode === 'date' && !isDateInputStillOpen(expiryDate)) {
      setError('请把截止日期调整到今天或未来日期')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await onSave({ expiresAt: mode === 'permanent' ? null : expiryDate, status: 'active' })
      if (!saved) setSaving(false)
    } catch (saveError) {
      setError(saveError.message || '保存截至时间失败')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal share-expiry-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">分享管理</p><h2>设置截至时间</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭截至时间设置" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body share-expiry-form">
          <div className="setting-block">
            <span>分享截止时间</span>
            <div className="option-grid compact-grid">
              <button className={mode === 'date' ? 'selected' : ''} onClick={() => setMode('date')}>自定义日期{mode === 'date' && <Check size={14} />}</button>
              <button className={mode === 'permanent' ? 'selected' : ''} onClick={() => canUsePermanent && setMode('permanent')} disabled={!canUsePermanent} title={!canUsePermanent ? '永久保存需要企业版权益' : ''}>永久保存{mode === 'permanent' && <Check size={14} />}</button>
            </div>
            {mode === 'date' && <DatePicker value={expiryDate} onChange={setExpiryDate} ariaLabel="分享截止日期" />}
            {!canUsePermanent && <small className="setting-hint">永久保存需要企业版权益，会员可自定义截止时间。</small>}
          </div>
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving || (mode === 'permanent' && !canUsePermanent)} onClick={submit}>{saving ? '保存中' : '保存设置'}</button>
        </div>
      </div>
    </div>
  )
}

export function RecordsView({ records, user, syncing = false, onCopy, onCopyQrImage, onDelete, onRename, onClear, onRefresh, onOpen, onOpenCollectionManager, onUpload, onManage, onCloseManaged, onReopenManaged, onSaveShareExpiry, onNotify }) {
  const [viewMode, setViewMode] = useState(() => new URLSearchParams(window.location.search).get('center') === 'files' ? 'files' : 'records')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [recordQuery, setRecordQuery] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [fileCategory, setFileCategory] = useState('all')
  const [fileFilterOpen, setFileFilterOpen] = useState(false)
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [openMenu, setOpenMenu] = useState(null)
  // 行操作菜单改为挂到 body 的 fixed 浮层：表格容器有 overflow 与固定高度，
  // 原来的 absolute 菜单会被裁掉，用户必须滚动表格才能看到剩余操作。
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuRecord, setMenuRecord] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [shareExpiryTarget, setShareExpiryTarget] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  const [previewChoices, setPreviewChoices] = useState(null)
  const [qrPreview, setQrPreview] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [recordPage, setRecordPage] = useState(1)
  const [filePage, setFilePage] = useState(1)
  const { startDownload: startRecordPreviewDownload, downloadBusy: previewDownloadBusy } = useDownloadTask()

  const normalizedRecords = records.map(normalizeRecord)
  const filteredRecords = normalizedRecords.filter((record) => (
    matchesRecordScope(record, scopeFilter)
    && matchesRecordDate(record, dateFilter, dateFrom, dateTo)
    && matchesRecordStatus(record, statusFilter)
    && (!recordQuery.trim() || `${recordDisplayName(record)} ${record.name} ${record.code}`.toLowerCase().includes(recordQuery.trim().toLowerCase()))
  ))
  const fileItems = managedFileItemsFromRecords(normalizedRecords)
  const filteredFileItems = fileItems.filter((item) => (
    matchesManagedFileSearch(item, fileQuery)
    && matchesManagedFileCategory(item, fileCategory)
    && (!expiringOnly || item.expiringSoon)
  ))
  const recordsPageSize = 8
  const filePageSize = 7
  const recordPageCount = Math.max(1, Math.ceil(filteredRecords.length / recordsPageSize))
  const filePageCount = Math.max(1, Math.ceil(filteredFileItems.length / filePageSize))
  const safeRecordPage = Math.min(recordPage, recordPageCount)
  const safeFilePage = Math.min(filePage, filePageCount)
  const visibleRecords = filteredRecords.slice((safeRecordPage - 1) * recordsPageSize, safeRecordPage * recordsPageSize)
  const visibleFileItems = filteredFileItems.slice((safeFilePage - 1) * filePageSize, safeFilePage * filePageSize)
  const expiringItems = fileItems.filter((item) => item.expiringSoon)
  const visibleIds = Array.from(new Set((viewMode === 'files' ? visibleFileItems.map((item) => item.record.id) : visibleRecords.map((record) => record.id))))
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const recordCounts = RECORD_SCOPE_TABS.reduce((acc, tab) => {
    acc[tab.key] = tab.key === 'all' ? normalizedRecords.length : normalizedRecords.filter((record) => record.scope === tab.key).length
    return acc
  }, {})
  const activeScopeTab = RECORD_SCOPE_TABS.find((tab) => tab.key === scopeFilter) || null
  const scopeClearLabel = scopeFilter === 'all' ? '清空全部' : `清空「${activeScopeTab?.label || '本分类'}」`
  const scopeClearDisabled = !(scopeFilter === 'all' ? normalizedRecords.length : recordCounts[scopeFilter])
  const storageUsedBytes = Math.max(0, Number(user?.capacity?.usedBytes) || 0)
  const storageTotalBytes = Math.max(0, Number(user?.capacity?.totalBytes || user?.plan?.totalBytes) || 0)
  const storageUsagePercent = storageTotalBytes ? Math.min(100, storageUsedBytes / storageTotalBytes * 100) : 0

  const changeViewMode = (nextMode) => {
    setViewMode(nextMode)
    const url = new URL(window.location.href)
    if (nextMode === 'files') url.searchParams.set('center', 'files')
    else url.searchParams.delete('center')
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  useEffect(() => {
    const syncViewMode = () => setViewMode(new URLSearchParams(window.location.search).get('center') === 'files' ? 'files' : 'records')
    window.addEventListener('popstate', syncViewMode)
    return () => window.removeEventListener('popstate', syncViewMode)
  }, [])

  useEffect(() => {
    handleRefresh({ silent: true }).catch(() => {})
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
    setOpenMenu(null)
    setMenuRecord(null)
    setMenuAnchor(null)
    setRecordPage(1)
    setFilePage(1)
  }, [viewMode, scopeFilter, dateFilter, dateFrom, dateTo, statusFilter, recordQuery, fileQuery, fileCategory, expiringOnly])

  useEffect(() => {
    const liveIds = new Set(normalizedRecords.map((record) => record.id))
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => liveIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [records])

  useEffect(() => {
    if (!openMenu) return undefined
    // 菜单是 fixed 浮层：滚动/缩放后锚点会漂移，直接关掉比留在错误位置更稳妥。
    // 菜单自身内部的滚动不算（否则用户滚菜单就被关掉）。
    const close = () => { setOpenMenu(null); setMenuRecord(null); setMenuAnchor(null) }
    const onScroll = (event) => {
      if (event.target instanceof Element && event.target.closest('.record-menu')) return
      close()
    }
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  useEffect(() => {
    if (!fileFilterOpen) return undefined
    const closeFilter = () => setFileFilterOpen(false)
    window.addEventListener('click', closeFilter)
    return () => window.removeEventListener('click', closeFilter)
  }, [fileFilterOpen])

  const handleRefresh = async (options = {}) => {
    setRefreshing(true)
    try {
      await onRefresh(options)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleMenu = (menuId, event, record) => {
    event.stopPropagation()
    if (openMenu === menuId) {
      setOpenMenu(null); setMenuRecord(null); setMenuAnchor(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 214
    const margin = 12
    // 估算菜单高度：条数 × 34 + 上下 padding，用于决定向上还是向下展开。
    const itemCount = record.scope === 'my_sent' && record.kind === 'share' ? 8 : record.scope === 'my_collections' ? 7 : 4
    const estimated = itemCount * 34 + 22
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const openUp = spaceBelow < estimated && spaceAbove > spaceBelow
    // 可用高度取展开方向的空间：正常视口下一屏能放下全部操作，不再需要滚动。
    const available = Math.max(120, Math.min(openUp ? spaceAbove : spaceBelow, window.innerHeight - margin * 2))
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))
    setMenuAnchor({
      left: Math.round(left),
      width,
      maxHeight: Math.round(available),
      top: openUp ? null : Math.round(rect.bottom + 6),
      bottom: openUp ? Math.round(window.innerHeight - rect.top + 6) : null,
    })
    setMenuRecord(record)
    setOpenMenu(menuId)
  }

  const runMenuAction = (action) => (event) => {
    event.stopPropagation()
    setOpenMenu(null); setMenuRecord(null); setMenuAnchor(null)
    action()
  }

  const toggleRecord = (recordId) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const deleteSelected = () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    onDelete(ids)
    setSelectedIds(new Set())
  }

  const hasRecordFilters = dateFilter !== 'all' || Boolean(dateFrom) || Boolean(dateTo) || statusFilter !== 'all' || Boolean(recordQuery.trim())
  const resetRecordFilters = () => {
    setDateFilter('all')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
    setRecordQuery('')
  }
  const hasFileFilters = Boolean(fileQuery.trim()) || fileCategory !== 'all' || expiringOnly
  const resetFileFilters = () => {
    setFileQuery('')
    setFileCategory('all')
    setExpiringOnly(false)
    setFileFilterOpen(false)
  }

  const fileCategoryCount = (category) => category === 'all'
    ? fileItems.length
    : fileItems.filter((item) => matchesManagedFileCategory(item, category)).length

  const downloadFileItem = (record) => {
    if (record.scope === 'my_collections' && onOpenCollectionManager) {
      onOpenCollectionManager(recordManageUrl(record))
      return
    }
    const previews = recordPreviewConfigs(record)
    if (record.kind === 'share' && record.files?.length === 1 && previews.length === 1) {
      startRecordPreviewDownload(previews[0].downloadConfig)
      return
    }
    onOpen(record)
  }

  const requestRename = (record) => {
    if (!onRename) return
    setRenameTarget(normalizeRecord(record))
  }

  const saveRename = (nextName) => {
    if (!renameTarget || !onRename) return
    onRename(renameTarget, nextName)
    setRenameTarget(null)
  }

  const openRecordPreview = (record) => {
    const previews = recordPreviewConfigs(record)
    if (previews.length === 1) {
      setPreviewItem(previews[0])
      return
    }
    if (previews.length > 1) setPreviewChoices(previews)
  }

  const openCollectionQr = async (record) => {
    const targetUrl = record.publicUrl || record.shareUrl
    if (!targetUrl) return
    try {
      const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 280, margin: 1 })
      setQrPreview({ qrDataUrl, targetUrl, title: `${recordDisplayName(record)}提交二维码` })
    } catch {
      onCopy?.(targetUrl)
    }
  }

  const openShareQr = async (record) => {
    const targetUrl = record.shareUrl || (record.shareId ? `${window.location.origin}/share/${record.shareId}` : '')
    if (!targetUrl) return
    try {
      const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 280, margin: 1 })
      setQrPreview({ qrDataUrl, targetUrl, title: `${recordDisplayName(record)}分享二维码`, detail: '扫码打开分享页面' })
    } catch {
      onCopy?.(targetUrl)
    }
  }

  const renderRecordMenu = (record) => {
    const link = recordLink(record)
    const copyTarget = recordCopyTarget(record)
    const shareUrl = record.kind === 'share' ? (record.shareUrl || link) : ''
    const statusGroup = recordStatusGroup(record)
    const noShareManagement = record.kind === 'share' && record.scope === 'my_sent' && record.status === '无管理权限'
    const closedShare = record.kind === 'share' && isClosedStatus(record.status)
    const reopenableCollection = canReopenCollection(record)
    return (
      <div
        className="record-menu row-menu record-menu-floating"
        style={menuAnchor ? {
          left: menuAnchor.left,
          width: menuAnchor.width,
          maxHeight: menuAnchor.maxHeight,
          // 两个方向都要显式覆盖：.row-menu 基础样式带 top，向上展开时若只设 bottom，
          // top/bottom 同时生效会把浮层压成细条并跑出视口。
          top: menuAnchor.top !== null ? menuAnchor.top : 'auto',
          bottom: menuAnchor.bottom !== null ? menuAnchor.bottom : 'auto',
        } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {record.scope !== 'my_collections' && (
          <button disabled={!copyTarget} onClick={runMenuAction(() => onCopy(copyTarget))}><Copy size={14} /> {recordCopyLabel(record)}</button>
        )}
        {record.scope === 'my_sent' && record.kind === 'share' ? (
          <>
            <button disabled={!shareUrl} onClick={runMenuAction(() => onCopy(shareUrl))}><Link2 size={14} /> 复制分享链接</button>
            <button disabled={!shareUrl} onClick={runMenuAction(() => openShareQr(record))}><QrCode size={14} /> 分享二维码</button>
          </>
        ) : (
          <button disabled={!link} onClick={runMenuAction(() => {
            if (record.scope === 'my_collections' && onOpenCollectionManager) {
              onOpenCollectionManager(recordManageUrl(record))
              return
            }
            onOpen(record)
          })}><ExternalLink size={14} /> {record.scope === 'my_collections' ? '查看已收文件' : recordOpenLabel(record)}</button>
        )}
        <button disabled={!onRename} onClick={runMenuAction(() => requestRename(record))}><PencilLine size={14} /> 重命名</button>
        {record.scope === 'my_sent' && (
          <>
            <button disabled={!recordManageUrl(record) || noShareManagement} onClick={runMenuAction(() => onManage(record))}><Settings2 size={14} /> 管理分享设置</button>
            <button disabled={!recordManageUrl(record) || noShareManagement} onClick={runMenuAction(() => {
              // 与服务端 applyShareUpdate 同口径：改有效期 = 会员特权（付费且在有效期内），
              // 永久保存才要求 permanent。此前误用 plan.permanent 预检，把月卡/季卡会员拦在门外。
              const hasMembership = Boolean(user?.plan?.permanent || (user?.plan?.id && user?.plan?.id !== 'free'))
              if (!hasMembership) {
                onNotify?.('设置分享截止时间需要会员版或更高权益')
                return
              }
              setShareExpiryTarget(record)
            })}><CalendarDays size={14} /> 设置截至时间</button>
            {closedShare ? (
              <button disabled={!recordManageUrl(record) || noShareManagement} onClick={runMenuAction(() => onReopenManaged(record))}><RefreshCw size={14} /> 重新开启分享</button>
            ) : (
              <button className="danger" disabled={!recordManageUrl(record) || noShareManagement} onClick={runMenuAction(() => onCloseManaged(record))}><X size={14} /> 关闭分享链接</button>
            )}
          </>
        )}
        {record.scope === 'my_collections' && (
          <>
            <button disabled={!record.publicUrl && !record.shareUrl} onClick={runMenuAction(() => onCopy(record.publicUrl || record.shareUrl))}><Link2 size={14} /> 复制提交链接</button>
            <button disabled={!record.publicUrl && !record.shareUrl} onClick={runMenuAction(() => openCollectionQr(record))}><QrCode size={14} /> 查看提交二维码</button>
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><Settings2 size={14} /> 管理收集设置</button>
            {record.status === '已关闭' && reopenableCollection ? (
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onReopenManaged(record))}><RefreshCw size={14} /> 重新开启收集任务</button>
            ) : statusGroup === 'expired' ? (
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><CalendarDays size={14} /> 延长后开启</button>
            ) : (
              <button className="danger" disabled={!recordManageUrl(record) || statusGroup === 'expired'} onClick={runMenuAction(() => onCloseManaged(record))}><X size={14} /> 关闭收集任务</button>
            )}
          </>
        )}
        <button className="danger" onClick={runMenuAction(() => onDelete(record.id))}><Trash2 size={14} /> {user?.id ? '删除记录' : '删除本机记录'}</button>
      </div>
    )
  }

  const recordModeTabs = (
    <div className="records-mode-tabs" role="tablist" aria-label="记录视图">
      {RECORD_VIEW_MODES.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={viewMode === key} className={viewMode === key ? 'active' : ''} onClick={() => changeViewMode(key)}>
          <span>{label}</span>
          <strong>{key === 'files' ? fileItems.length : normalizedRecords.length}</strong>
        </button>
      ))}
    </div>
  )

  return (
    <section className={`workspace-page records-page${viewMode === 'records' ? ' records-page-records' : ' records-page-files'}`}>
      <div className="workspace-heading records-heading">
        <div>
          <h1>{viewMode === 'files' ? '文件管理中心' : '收发记录'}</h1>
          <p>{viewMode === 'files' ? '按类型查看所有发送、接收与收集的文件，快速定位与清理。' : '查看你发送与接收过的文件，可随时复制取件码或重新分享。'}</p>
        </div>
        <div className="records-heading-actions">
          {viewMode === 'records' ? recordModeTabs : (
            <>
              <button type="button" className="secondary-button" onClick={() => changeViewMode('records')}><ArrowLeft size={15} /> 返回收发记录</button>
              <button type="button" className="primary-button" onClick={onUpload}><Upload size={15} /> 上传文件</button>
            </>
          )}
          {viewMode === 'records' && (
            <button type="button" className="secondary-button records-clear-button" aria-label={scopeClearLabel} title={scopeClearLabel} disabled={scopeClearDisabled} onClick={() => { onClear(scopeFilter); setSelectedIds(new Set()) }}><Trash2 size={15} /> 清空记录</button>
          )}
        </div>
      </div>

      {viewMode === 'records' ? (
        <>
          <div className="records-filter-panel records-page-toolbar">
            <div className="records-toolbar-main">
              <div className="record-scope-tabs" role="tablist" aria-label="记录分类">
                {RECORD_SCOPE_TABS.map((tab) => (
                  <button key={tab.key} role="tab" aria-selected={scopeFilter === tab.key} className={scopeFilter === tab.key ? 'active' : ''} onClick={() => setScopeFilter(tab.key)}>
                    <span>{tab.label}</span>
                    <strong>{recordCounts[tab.key] || 0}</strong>
                  </button>
                ))}
              </div>
              <label className="record-date-select record-status-select">
                <select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {RECORD_STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="record-date-select record-date-range-select">
                <select aria-label="日期筛选" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                  {RECORD_DATE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="record-search-box records-search-box">
                <Search size={15} />
                <input type="search" maxLength={160} value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder="搜索文件名或取件码" aria-label="搜索文件名或取件码" />
              </label>
            </div>
          </div>
          <div className="records-secondary-row">
              <div className="records-secondary-main">
                {dateFilter === 'range' && (
                  <div className="record-filter-field record-date-field">
                    <span>日期范围</span>
                    <div className="record-date-range">
                      <DatePicker value={dateFrom} onChange={setDateFrom} ariaLabel="开始日期" placeholder="开始日期" />
                      <DatePicker value={dateTo} onChange={setDateTo} ariaLabel="结束日期" placeholder="结束日期" />
                    </div>
                  </div>
                )}
                <label className="record-select-all">
                  <input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} />
                  <span>已选 {selectedIds.size} 条 · 本页 {visibleRecords.length} 条 / 筛选 {filteredRecords.length} 条</span>
                </label>
              </div>
              <div className="records-secondary-actions">
                <div className="record-filter-actions">
                  <button className="secondary-button filter-reset-button" onClick={resetRecordFilters} disabled={!hasRecordFilters}><RotateCcw size={15} /> 重置</button>
                  <button className="secondary-button" aria-label="刷新记录" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={16} /> {refreshing ? '刷新中' : '刷新'}</button>
                </div>
                <div className="record-bulk-actions">
                  <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
                </div>
              </div>
          </div>

          <div className="records-table-surface" role="table" aria-label="收发记录列表">
            <div className="records-table-head" role="row">
              <span aria-hidden="true" />
              {['文件名', '方向', '取件码/入口', '大小', '时间', '状态', '操作'].map((label) => <span role="columnheader" key={label}>{label}</span>)}
            </div>
          <div className="records-list enhanced-records-list" role="rowgroup">
            {filteredRecords.length ? visibleRecords.map((record) => {
              const Icon = recordIconForScope(record.scope)
              const statusGroup = recordStatusGroup(record)
              const selected = selectedIds.has(record.id)
              return (
                <div className={`record-row record-row-enhanced ${record.scope === 'collect_from_me' ? 'record-submission-row' : ''} ${selected ? 'selected' : ''}`} key={record.id} role="row">
                  <label className="record-check" role="cell" aria-label={`选择 ${recordDisplayName(record)}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
                  </label>
                  <div className="record-file-cell" role="cell">
                    <span className={`record-icon ${record.scope}`}>{['my_collections', 'collect_from_me'].includes(record.scope) ? <PrototypeAsset name="act-clipboard.png" size={26} /> : <PrototypeFileIcon name={recordDisplayName(record)} fallback={Icon} size={24} />}</span>
                    <div className="record-main">
                      <div className="record-title-line">
                        <RecordNameText name={recordDisplayName(record)} />
                        <FileFormatBadge record={record} />
                      </div>
                      <span>{record.meta || recordDetail(record)}</span>
                    </div>
                  </div>
                  <span className={`record-direction ${record.scope}`} role="cell">{record.scope === 'my_sent' ? '发出' : record.scope === 'sent_to_me' ? '接收' : record.scope === 'my_collections' ? '收集' : '提交'}</span>
                  {record.scope === 'collect_from_me' ? (
                    <button type="button" role="cell" className="record-code record-submit-button" disabled={!recordLink(record) || !onOpen} aria-label={`${recordOpenLabel(record)}：${recordDisplayName(record)}`} onClick={() => onOpen(record)}><ExternalLink size={14} />{recordOpenLabel(record)}</button>
                  ) : <span className="record-code" role="cell">{record.code || '-'}</span>}
                  <span className="record-size" role="cell">{record.totalSize > 0 ? formatBytes(record.totalSize) : '—'}</span>
                  <time className="record-time" role="cell" dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
                  <span className={`record-type ${statusGroup}`} role="cell">{recordDisplayStatus(record)}</span>
                  <div className="menu-wrap row-menu-wrap" role="cell">
                    <span className="record-preview-slot">
                      {recordPreviewConfigs(record).length > 0 && !(record.scope === 'my_sent' && record.status === '无管理权限') && <button className="ghost-icon record-preview-button" aria-label={`预览文件：${recordDisplayName(record)}`} title="预览文件" onClick={() => openRecordPreview(record)}><Eye size={16} /></button>}
                    </span>
                    <button className="ghost-icon" aria-label={`更多操作：${recordDisplayName(record)}`} onClick={(event) => toggleMenu(record.id, event, record)}><MoreHorizontal size={17} /></button>
                  </div>
                </div>
              )
            }) : (
              <div className="empty-manage records-empty"><History size={25} /><span>没有符合当前筛选的记录</span></div>
            )}
          </div>
          </div>
          <AdminPagination page={safeRecordPage} pageCount={recordPageCount} total={filteredRecords.length} pageSize={recordsPageSize} onPageChange={setRecordPage} />
        </>
      ) : (
        <>
          <div className="files-layout">
            <aside className="file-cats" aria-label="文件分类与存储">
              <h2>文件类型</h2>
              <div className="file-category-list" role="tablist" aria-label="按文件类型筛选">
                {FILE_CATEGORY_FILTERS.map(([value, label]) => {
                  const Icon = FILE_CATEGORY_ICONS[value] || FileQuestion
                  return <button type="button" role="tab" aria-selected={fileCategory === value} className={fileCategory === value ? 'active' : ''} key={value} onClick={() => setFileCategory(value)}><Icon size={15} /><span>{label}</span><em>{fileCategoryCount(value)}</em></button>
                })}
              </div>
              <div className="cat-divider" />
              <h2>存储</h2>
              <div className="storage-box">
                <div className="storage-usage-line"><span>已用 {formatBytes(storageUsedBytes)}</span><small>共 {storageTotalBytes ? formatBytes(storageTotalBytes) : '—'}</small></div>
                <div className="file-storage-progress" role="progressbar" aria-label="账号存储空间使用情况" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(storageUsagePercent)}><i style={{ width: `${storageUsagePercent}%` }} /></div>
                <p>{user?.plan?.label ? `${user.plan.label}容量 · 清理过期文件可释放空间` : '登录后可查看账号空间使用情况'}</p>
              </div>
            </aside>

            <section className="file-center-card" aria-label="文件列表">
              <div className="file-center-card-heading">
                <div className="file-center-title"><h2>{fileCategory === 'all' ? '全部文件' : FILE_CATEGORY_FILTERS.find(([value]) => value === fileCategory)?.[1]}</h2><span>{filteredFileItems.length}</span></div>
                <div className="file-center-controls">
                  <label className="file-center-search"><Search size={14} /><input maxLength={160} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="搜索文件" aria-label="搜索文件" /></label>
                  <div className="file-filter-wrap">
                    <button type="button" className="secondary-button file-filter-button" aria-expanded={fileFilterOpen} onClick={(event) => { event.stopPropagation(); setFileFilterOpen((open) => !open) }}><Filter size={14} /> 筛选</button>
                    {fileFilterOpen && <div className="file-filter-popover" onClick={(event) => event.stopPropagation()}>
                      <label><input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} /><span>只看即将过期</span><em>{expiringItems.length}</em></label>
                      <button type="button" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={14} /> {refreshing ? '刷新中' : '刷新列表'}</button>
                      <button type="button" onClick={resetFileFilters} disabled={!hasFileFilters}><RotateCcw size={14} /> 重置筛选</button>
                      <button type="button" className="danger" disabled={!normalizedRecords.length} onClick={() => { setFileFilterOpen(false); onClear(); setSelectedIds(new Set()) }}><Trash2 size={14} /> 清空全部记录</button>
                    </div>}
                  </div>
                </div>
              </div>

              <div className="file-table-scroll" role="table" aria-label="文件管理列表">
                <div className="file-head" role="row">
                  <label className="rec-check" role="columnheader" aria-label="选择当前页"><input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} /></label>
                  {['文件名', '类型', '来源', '大小', '状态', '操作'].map((label) => <span role="columnheader" key={label}>{label}</span>)}
                </div>
                <div className="file-center-list" role="rowgroup">
                  {filteredFileItems.length ? visibleFileItems.map((item) => {
                    const record = item.record
                    const Icon = fileCategoryIcon(record.kind === 'collection' ? 'collection' : item.category)
                    const selected = selectedIds.has(record.id)
                    const previews = recordPreviewConfigs(record)
                    return (
                      <div className={`file-row2 file-center-row ${selected ? 'selected' : ''}`} key={item.id} role="row">
                        <label className="rec-check" role="cell" aria-label={`选择 ${item.name}`}><input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} /></label>
                        <div className="rec-name" role="cell">
                          <span className={`record-icon file-category-${item.category}`}>{item.category === 'collection' ? <PrototypeAsset name="act-clipboard.png" size={26} /> : <PrototypeFileIcon name={item.name} fallback={Icon} size={24} />}</span>
                          <div><RecordNameText name={item.name} /><small>{item.detail}</small></div>
                        </div>
                        <span className="file-format-cell">{item.formatLabel}</span>
                        <span className="file-source-cell">{recordScopeLabel(record.scope)}</span>
                        <span className="mono rec-size">{item.size ? formatBytes(item.size) : `${item.fileCount || 1} 项`}</span>
                        <span className="file-status-cell"><span className={`file-status-badge ${item.statusGroup}`}><i />{recordDisplayStatus(record)}</span></span>
                        <div className="row-acts file-row-actions menu-wrap row-menu-wrap" role="cell">
                          <button className="icon-act" title="预览" aria-label={`预览：${item.name}`} disabled={!previews.length || (record.scope === 'my_sent' && record.status === '无管理权限')} onClick={() => openRecordPreview(record)}><Eye size={15} /></button>
                          <button className="icon-act" title="下载" aria-label={`下载：${item.name}`} disabled={previewDownloadBusy} onClick={() => downloadFileItem(record)}><Download size={15} /></button>
                          <button className="icon-act danger" title="删除" aria-label={`删除：${item.name}`} onClick={() => onDelete(record.id)}><Trash2 size={15} /></button>
                          <button className="icon-act file-more-button" title="更多操作" aria-label={`更多操作：${item.name}`} onClick={(event) => toggleMenu(item.id, event, record)}><MoreHorizontal size={15} /></button>
                        </div>
                      </div>
                    )
                  }) : <div className="empty-manage records-empty"><HardDrive size={25} /><span>没有符合当前筛选的文件项目</span></div>}
                </div>
              </div>

              <div className="file-center-footer">
                <div><span>共 {filteredFileItems.length} 个文件 · 已选择 {selectedIds.size} 个</span>{selectedIds.size > 0 && <button type="button" className="file-bulk-delete" onClick={deleteSelected}><Trash2 size={14} /> 删除所选</button>}</div>
                <div className="file-center-pagination"><button type="button" disabled={safeFilePage <= 1} onClick={() => setFilePage(Math.max(1, safeFilePage - 1))}>上一页</button><span>{safeFilePage} / {filePageCount}</span><button type="button" disabled={safeFilePage >= filePageCount} onClick={() => setFilePage(Math.min(filePageCount, safeFilePage + 1))}>下一页</button></div>
              </div>
            </section>
          </div>
        </>
      )}
      {renameTarget && <RenameRecordModal record={renameTarget} onClose={() => setRenameTarget(null)} onSave={saveRename} />}
      {shareExpiryTarget && <ShareExpiryModal record={shareExpiryTarget} canUsePermanent={Boolean(user?.plan?.permanent)} onClose={() => setShareExpiryTarget(null)} onSave={async (payload) => { const saved = await onSaveShareExpiry?.(shareExpiryTarget, payload); if (saved) setShareExpiryTarget(null); return saved }} />}
      {previewChoices && <RecordPreviewChooser previews={previewChoices} onClose={() => setPreviewChoices(null)} onSelect={(preview) => setPreviewItem(preview)} />}
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startRecordPreviewDownload(config || previewItem.downloadConfig)} downloadDisabled={previewDownloadBusy} />}
      {qrPreview && <QrPreviewModal title={qrPreview.title} detail={qrPreview.detail || '扫码打开提交入口'} qrDataUrl={qrPreview.qrDataUrl} targetUrl={qrPreview.targetUrl} onClose={() => setQrPreview(null)} onCopyImage={() => onCopyQrImage?.(qrPreview.qrDataUrl, qrPreview.targetUrl)} onCopyLink={() => onCopy?.(qrPreview.targetUrl)} />}
      {openMenu && menuRecord && menuAnchor && createPortal(renderRecordMenu(menuRecord), document.body)}
      <div className="records-footnote"><HardDrive size={16} /> {syncing ? '账号记录同步中...' : user?.id ? '已登录，记录会同步到账号并可跨设备查看。' : '游客记录仅保留在当前设备，登录后可跨设备同步。'}</div>
    </section>
  )
}
