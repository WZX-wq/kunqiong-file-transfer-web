import React from 'react'
import { canReopenCollection, fileCategoryIcon, isDateInputStillOpen, managedFileItemsFromRecords, matchesManagedFileCategory, matchesManagedFileSearch, matchesRecordDate, matchesRecordScope, matchesRecordStatus, normalizeRecord, recordCopyLabel, recordCopyTarget, recordDetail, recordDisplayName, recordDisplayStatus, recordExpiryLabel, recordIconForScope, recordLink, recordManageUrl, recordOpenLabel, recordScopeLabel, recordStatusGroup, toDateInputValue } from '../lib/records.js'
import { useEffect, useState } from 'react'
import { defaultDeadline, formatBytes, isClosedStatus } from '../lib/format.js'
import { CalendarDays, Check, Clock3, Copy, ExternalLink, Eye, FileWarning, HardDrive, History, Link2, MoreHorizontal, PencilLine, QrCode, RefreshCw, RotateCcw, Search, Settings2, Trash2, X } from 'lucide-react'
import { DatePicker, FileFormatBadge, FilePreviewModal, QrPreviewModal, RecordNameText, RecordPreviewChooser, RenameRecordModal } from '../components/ui.jsx'
import { useDownloadTask } from '../hooks.js'
import { FILE_CATEGORY_FILTERS, RECORD_DATE_FILTERS, RECORD_SCOPE_TABS, RECORD_STATUS_FILTERS, RECORD_VIEW_MODES } from '../lib/constants.js'
import { recordPreviewConfigs } from '../lib/transfer.js'
import QRCode from 'qrcode'
import { AdminPagination } from './AdminPage.jsx'

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

export function RecordsView({ records, user, syncing = false, onCopy, onCopyQrImage, onDelete, onRename, onClear, onRefresh, onOpen, onOpenCollectionManager, onManage, onCloseManaged, onReopenManaged, onSaveShareExpiry, onNotify }) {
  const [viewMode, setViewMode] = useState('records')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fileQuery, setFileQuery] = useState('')
  const [fileCategory, setFileCategory] = useState('all')
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [openMenu, setOpenMenu] = useState(null)
  const [menuPlacement, setMenuPlacement] = useState('down')
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
  ))
  const fileItems = managedFileItemsFromRecords(normalizedRecords)
  const filteredFileItems = fileItems.filter((item) => (
    matchesManagedFileSearch(item, fileQuery)
    && matchesManagedFileCategory(item, fileCategory)
    && (!expiringOnly || item.expiringSoon)
  ))
  const recordsPageSize = 8
  const recordPageCount = Math.max(1, Math.ceil(filteredRecords.length / recordsPageSize))
  const filePageCount = Math.max(1, Math.ceil(filteredFileItems.length / recordsPageSize))
  const safeRecordPage = Math.min(recordPage, recordPageCount)
  const safeFilePage = Math.min(filePage, filePageCount)
  const visibleRecords = filteredRecords.slice((safeRecordPage - 1) * recordsPageSize, safeRecordPage * recordsPageSize)
  const visibleFileItems = filteredFileItems.slice((safeFilePage - 1) * recordsPageSize, safeFilePage * recordsPageSize)
  const expiringItems = fileItems.filter((item) => item.expiringSoon)
  const visibleIds = Array.from(new Set((viewMode === 'files' ? visibleFileItems.map((item) => item.record.id) : visibleRecords.map((record) => record.id))))
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const recordCounts = RECORD_SCOPE_TABS.reduce((acc, tab) => {
    acc[tab.key] = tab.key === 'all' ? normalizedRecords.length : normalizedRecords.filter((record) => record.scope === tab.key).length
    return acc
  }, {})
  const managedFileCount = fileItems.reduce((sum, item) => sum + item.fileCount, 0)
  const managedTotalSize = fileItems.reduce((sum, item) => sum + item.size, 0)
  const activeScopeTab = RECORD_SCOPE_TABS.find((tab) => tab.key === scopeFilter) || null
  const scopeClearLabel = scopeFilter === 'all' ? '清空全部' : `清空「${activeScopeTab?.label || '本分类'}」`
  const scopeClearDisabled = !(scopeFilter === 'all' ? normalizedRecords.length : recordCounts[scopeFilter])

  useEffect(() => {
    handleRefresh({ silent: true }).catch(() => {})
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
    setOpenMenu(null)
    setMenuPlacement('down')
    setRecordPage(1)
    setFilePage(1)
  }, [viewMode, scopeFilter, dateFilter, dateFrom, dateTo, statusFilter, fileQuery, fileCategory, expiringOnly])

  useEffect(() => {
    const liveIds = new Set(normalizedRecords.map((record) => record.id))
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => liveIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [records])

  useEffect(() => {
    if (!openMenu) return undefined
    const closeMenu = () => setOpenMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [openMenu])

  const handleRefresh = async (options = {}) => {
    setRefreshing(true)
    try {
      await onRefresh(options)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleMenu = (menuId, event) => {
    event.stopPropagation()
    if (openMenu !== menuId) {
      const rect = event.currentTarget.getBoundingClientRect()
      const estimatedMenuHeight = 324
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setMenuPlacement(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down')
    }
    setOpenMenu((current) => (current === menuId ? null : menuId))
  }

  const runMenuAction = (action) => (event) => {
    event.stopPropagation()
    setOpenMenu(null)
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

  const hasRecordFilters = dateFilter !== 'all' || Boolean(dateFrom) || Boolean(dateTo) || statusFilter !== 'all'
  const resetRecordFilters = () => {
    setDateFilter('all')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
  }
  const hasFileFilters = Boolean(fileQuery.trim()) || fileCategory !== 'all' || expiringOnly
  const resetFileFilters = () => {
    setFileQuery('')
    setFileCategory('all')
    setExpiringOnly(false)
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
    const closedShare = record.kind === 'share' && isClosedStatus(record.status)
    const reopenableCollection = canReopenCollection(record)
    return (
      <div className={`record-menu row-menu ${menuPlacement === 'up' ? 'menu-up' : ''}`} onClick={(event) => event.stopPropagation()}>
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
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><Settings2 size={14} /> 管理分享设置</button>
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => {
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
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onReopenManaged(record))}><RefreshCw size={14} /> 重新开启分享</button>
            ) : (
              <button className="danger" disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onCloseManaged(record))}><X size={14} /> 关闭分享链接</button>
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

  return (
    <section className="workspace-page records-page">
      <div className="workspace-heading records-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> 你的临时空间</p>
          <h1>{viewMode === 'files' ? '文件管理中心' : '收发记录'}</h1>
          <p>按发送、接收、收集和提交归档最近活动，登录后同步到账号。</p>
        </div>
      </div>

      <div className="records-mode-tabs" role="tablist" aria-label="记录视图">
        {RECORD_VIEW_MODES.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={viewMode === key} className={viewMode === key ? 'active' : ''} onClick={() => setViewMode(key)}>
            <span>{label}</span>
            <strong>{key === 'files' ? fileItems.length : normalizedRecords.length}</strong>
          </button>
        ))}
      </div>

      {viewMode === 'records' ? (
        <>
          <div className="record-scope-tabs" role="tablist" aria-label="记录分类">
            {RECORD_SCOPE_TABS.map((tab) => (
              <button key={tab.key} role="tab" aria-selected={scopeFilter === tab.key} className={scopeFilter === tab.key ? 'active' : ''} onClick={() => setScopeFilter(tab.key)}>
                <span>{tab.label}</span>
                <strong>{recordCounts[tab.key] || 0}</strong>
              </button>
            ))}
          </div>

          <div className="records-filter-panel">
            <div className="records-filter-row">
              <label className="record-filter-field">
                <span>日期</span>
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                  {RECORD_DATE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {dateFilter === 'range' && (
                <div className="record-filter-field record-date-field">
                  <span>日期范围</span>
                  <div className="record-date-range">
                    <DatePicker value={dateFrom} onChange={setDateFrom} ariaLabel="开始日期" placeholder="开始日期" />
                    <DatePicker value={dateTo} onChange={setDateTo} ariaLabel="结束日期" placeholder="结束日期" />
                  </div>
                </div>
              )}
              <label className="record-filter-field">
                <span>状态</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {RECORD_STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="record-filter-actions">
                <button className="secondary-button filter-reset-button" onClick={resetRecordFilters} disabled={!hasRecordFilters}><RotateCcw size={15} /> 重置</button>
                <button className="secondary-button" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={16} /> {refreshing ? '刷新中' : '刷新'}</button>
              </div>
            </div>
            <div className="records-bulk-row">
              <label className="record-select-all">
                <input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} />
                <span>已选 {selectedIds.size} 条 · 本页 {visibleRecords.length} 条 / 筛选 {filteredRecords.length} 条</span>
              </label>
              <div className="record-bulk-actions">
                <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
                <button className="secondary-button" disabled={scopeClearDisabled} onClick={() => { onClear(scopeFilter); setSelectedIds(new Set()) }}><Trash2 size={15} /> {scopeClearLabel}</button>
              </div>
            </div>
          </div>

          <div className="records-list enhanced-records-list">
            {filteredRecords.length ? visibleRecords.map((record) => {
              const Icon = recordIconForScope(record.scope)
              const statusGroup = recordStatusGroup(record)
              const selected = selectedIds.has(record.id)
              return (
                <div className={`record-row record-row-enhanced ${record.scope === 'collect_from_me' ? 'record-submission-row' : ''} ${selected ? 'selected' : ''}`} key={record.id}>
                  <label className="record-check" aria-label={`选择 ${recordDisplayName(record)}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
                  </label>
                  <span className={`record-icon ${record.scope}`}><Icon size={17} /></span>
                  <div className="record-main">
                    <div className="record-title-line">
                      <RecordNameText name={recordDisplayName(record)} />
                      <FileFormatBadge record={record} />
                      <span className="scope-pill">{recordScopeLabel(record.scope)}</span>
                    </div>
                    <span>{record.meta || recordDetail(record)}</span>
                  </div>
                  <span className="record-expiry">{recordExpiryLabel(record)}</span>
                  <span className={`record-type ${statusGroup}`}>{recordDisplayStatus(record)}</span>
                  {record.scope === 'collect_from_me' ? (
                    <button type="button" className="record-code record-submit-button" disabled={!recordLink(record) || !onOpen} aria-label={`${recordOpenLabel(record)}：${recordDisplayName(record)}`} onClick={() => onOpen(record)}><ExternalLink size={14} />{recordOpenLabel(record)}</button>
                  ) : <span className="record-code">{record.code || '-'}</span>}
                  <div className="menu-wrap row-menu-wrap">
                    {recordPreviewConfigs(record).length > 0 && <button className="ghost-icon record-preview-button" aria-label={`预览文件：${recordDisplayName(record)}`} title="预览文件" onClick={() => openRecordPreview(record)}><Eye size={16} /></button>}
                    <button className="ghost-icon" aria-label={`更多操作：${recordDisplayName(record)}`} onClick={(event) => toggleMenu(record.id, event)}><MoreHorizontal size={17} /></button>
                    {openMenu === record.id && renderRecordMenu(record)}
                  </div>
                </div>
              )
            }) : (
              <div className="empty-manage records-empty"><History size={25} /><span>没有符合当前筛选的记录</span></div>
            )}
          </div>
          <AdminPagination page={safeRecordPage} pageCount={recordPageCount} total={filteredRecords.length} pageSize={recordsPageSize} onPageChange={setRecordPage} />
        </>
      ) : (
        <>
          <div className="file-center-stats">
            <div><span>管理项目</span><strong>{fileItems.length}</strong></div>
            <div><span>文件数</span><strong>{managedFileCount}</strong></div>
            <div><span>总大小</span><strong>{managedTotalSize ? formatBytes(managedTotalSize) : '-'}</strong></div>
            <div><span>即将过期</span><strong>{expiringItems.length}</strong></div>
          </div>

          {expiringItems.length > 0 && (
            <div className="file-expiry-alert">
              <Clock3 size={18} />
              <div><strong>{expiringItems.length} 个项目将在 1 天内过期</strong><span>可进入管理设置延期、关闭或清理记录。</span></div>
              <button className="secondary-button" onClick={() => setExpiringOnly(true)}><FileWarning size={15} /> 查看即将过期</button>
            </div>
          )}

          <div className="records-filter-panel file-center-filter">
            <div className="records-filter-row">
              <label className="record-filter-field file-search-field">
                <span>搜索</span>
                <div className="record-search-box">
                  <Search size={15} />
                  <input maxLength={160} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="文件名 / 取件码 / 提交人" />
                </div>
              </label>
              <label className="record-filter-field">
                <span>分类</span>
                <select value={fileCategory} onChange={(event) => setFileCategory(event.target.value)}>
                  {FILE_CATEGORY_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="record-toggle-field">
                <input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} />
                <span>只看即将过期</span>
              </label>
              <div className="record-filter-actions">
                <button className="secondary-button filter-reset-button" onClick={resetFileFilters} disabled={!hasFileFilters}><RotateCcw size={15} /> 重置</button>
                <button className="secondary-button" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={16} /> {refreshing ? '刷新中' : '刷新'}</button>
              </div>
            </div>
            <div className="records-bulk-row">
              <label className="record-select-all">
                <input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} />
                <span>已选 {selectedIds.size} 项 · 本页 {visibleFileItems.length} 项 / 筛选 {filteredFileItems.length} 项</span>
              </label>
              <div className="record-bulk-actions">
                <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
                <button className="secondary-button" disabled={!normalizedRecords.length} onClick={() => { onClear(); setSelectedIds(new Set()) }}><Trash2 size={15} /> 清空全部</button>
              </div>
            </div>
          </div>

          <div className="records-list enhanced-records-list file-center-list">
            {filteredFileItems.length ? visibleFileItems.map((item) => {
              const record = item.record
              const Icon = fileCategoryIcon(item.category)
              const selected = selectedIds.has(record.id)
              return (
                <div className={`record-row record-row-enhanced file-center-row ${selected ? 'selected' : ''}`} key={item.id}>
                  <label className="record-check" aria-label={`选择 ${item.name}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
                  </label>
                  <span className={`record-icon file-category-${item.category}`}><Icon size={17} /></span>
                  <div className="record-main">
                    <div className="record-title-line">
                      <RecordNameText name={item.name} />
                      <span className="scope-pill">{item.categoryLabel}</span>
                      <span className="scope-pill file-format-pill">{item.formatLabel}</span>
                      <span className="scope-pill muted">{recordScopeLabel(record.scope)}</span>
                    </div>
                    <span>{item.detail}</span>
                  </div>
                  <span className="record-expiry">{recordExpiryLabel(record)}</span>
                  <span className={`record-type ${item.statusGroup}`}>{recordDisplayStatus(record)}</span>
                  <span className="record-code">{item.size ? formatBytes(item.size) : `${item.fileCount || 1} 项`}</span>
                  <div className="menu-wrap row-menu-wrap">
                    {recordPreviewConfigs(record).length > 0 && <button className="ghost-icon record-preview-button" aria-label={`预览文件：${item.name}`} title="预览文件" onClick={() => openRecordPreview(record)}><Eye size={16} /></button>}
                    <button className="ghost-icon" aria-label={`更多操作：${item.name}`} onClick={(event) => toggleMenu(item.id, event)}><MoreHorizontal size={17} /></button>
                    {openMenu === item.id && renderRecordMenu(record)}
                  </div>
                </div>
              )
            }) : (
              <div className="empty-manage records-empty"><HardDrive size={25} /><span>没有符合当前筛选的文件项目</span></div>
            )}
          </div>
          <AdminPagination page={safeFilePage} pageCount={filePageCount} total={filteredFileItems.length} pageSize={recordsPageSize} onPageChange={setFilePage} />
        </>
      )}
      {renameTarget && <RenameRecordModal record={renameTarget} onClose={() => setRenameTarget(null)} onSave={saveRename} />}
      {shareExpiryTarget && <ShareExpiryModal record={shareExpiryTarget} canUsePermanent={Boolean(user?.plan?.permanent)} onClose={() => setShareExpiryTarget(null)} onSave={async (payload) => { const saved = await onSaveShareExpiry?.(shareExpiryTarget, payload); if (saved) setShareExpiryTarget(null); return saved }} />}
      {previewChoices && <RecordPreviewChooser previews={previewChoices} onClose={() => setPreviewChoices(null)} onSelect={(preview) => setPreviewItem(preview)} />}
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startRecordPreviewDownload(config || previewItem.downloadConfig)} downloadDisabled={previewDownloadBusy} />}
      {qrPreview && <QrPreviewModal title={qrPreview.title} detail={qrPreview.detail || '扫码打开提交入口'} qrDataUrl={qrPreview.qrDataUrl} targetUrl={qrPreview.targetUrl} onClose={() => setQrPreview(null)} onCopyImage={() => onCopyQrImage?.(qrPreview.qrDataUrl, qrPreview.targetUrl)} onCopyLink={() => onCopy?.(qrPreview.targetUrl)} />}
      <div className="records-footnote"><HardDrive size={16} /> {syncing ? '账号记录同步中...' : user?.id ? '已登录，记录会同步到账号并可跨设备查看。' : '游客记录仅保留在当前设备，登录后可跨设备同步。'}</div>
    </section>
  )
}
