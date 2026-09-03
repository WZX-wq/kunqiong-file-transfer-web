import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  History,
  Inbox,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import './styles.css'

const MAX_FILES = 100
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
const defaultSettings = {
  expiry: '3 天',
  expiryDays: '3',
  downloads: '不限次数',
  downloadLimit: 'unlimited',
  customDownloadLimit: '5',
  codeLength: '4',
  recipients: '',
  passwordEnabled: false,
  password: '',
}

const createDefaultCollectionForm = () => ({
  title: '',
  description: '',
  deadline: defaultDeadline(10),
  allowedTypes: ['图片', '文档'],
  maxFileSizeMb: 500,
})

const fileIcon = (name = '') => {
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive
  if (/\.(pdf|doc|docx|txt|xls|xlsx|ppt|pptx)$/i.test(name)) return FileText
  return FileCheck2
}

function App() {
  const route = window.location.pathname
  if (route.startsWith('/share/')) return <SharePage token={route.split('/')[2]} />
  if (route.startsWith('/collect/manage/')) return <CollectionManagePage token={route.split('/')[3]} />
  if (route.startsWith('/collect/')) return <CollectionSubmitPage token={route.split('/')[2]} />
  return <WorkspaceApp />
}

function WorkspaceApp() {
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)
  const uploadRef = useRef(createUploadSessionState())
  const [activeView, setActiveView] = useState('send')
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadState, setUploadState] = useState(createUploadState())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [retrieveOpen, setRetrieveOpen] = useState(false)
  const [retrievalCode, setRetrievalCode] = useState('')
  const [retrieveResult, setRetrieveResult] = useState(null)
  const [shareResult, setShareResult] = useState(null)
  const [collectionResult, setCollectionResult] = useState(null)
  const [collectionManageData, setCollectionManageData] = useState(null)
  const [collectionManageLoading, setCollectionManageLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [settings, setSettings] = useState(defaultSettings)
  const [records, setRecords] = useState(() => readRecords())

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const addFiles = (incoming) => {
    const nextFiles = Array.from(incoming || []).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      relativePath: file.webkitRelativePath || file.name,
    }))
    const invalid = nextFiles.find((item) => item.size > MAX_FILE_SIZE)
    if (invalid) {
      setToast(`${invalid.name} 超过 5 GB 限制`)
      return
    }
    setFiles((current) => {
      const merged = [...current, ...nextFiles]
      if (merged.length > MAX_FILES) setToast(`本次测试单次最多上传 ${MAX_FILES} 个文件，已保留前 ${MAX_FILES} 个`)
      return merged.slice(0, MAX_FILES)
    })
    setShareResult(null)
    setUploadProgress(0)
    setUploadState(createUploadState())
    uploadRef.current = createUploadSessionState()
  }

  const uploadFiles = async ({ resume = false } = {}) => {
    if (!files.length) {
      inputRef.current?.click()
      return
    }
    setIsUploading(true)
    setShareResult(null)
    if (!resume) {
      setUploadProgress(0)
      uploadRef.current = createUploadSessionState()
    }
    uploadRef.current.paused = false
    try {
      const data = await uploadShareInChunks(files, settings, uploadRef, ({ progress, ...nextState }) => {
        setUploadProgress(progress)
        setUploadState((current) => ({ ...current, ...nextState, progress }))
      })
      setShareResult(data.share)
      setFiles([])
      uploadRef.current = createUploadSessionState()
      setUploadState(createUploadState())
      saveRecord(createShareRecord(data.share, 'my_sent'))
      setToast(data.share.deliveryRecipients?.length ? '文件已上传，模拟通知已生成' : '文件已上传，分享信息已生成')
    } catch (error) {
      if (error.name === 'UploadPausedError') {
        setUploadState((current) => ({ ...current, status: 'paused', phase: '已暂停，可继续上传', error: '' }))
        return
      }
      setUploadState((current) => ({ ...current, status: 'failed', phase: '上传失败', error: error.message }))
      setToast(error.message)
    } finally {
      setIsUploading(false)
    }
  }

  const pauseUpload = () => {
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
  }

  const resetSend = () => {
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
    uploadRef.current = createUploadSessionState()
    setFiles([])
    setShareResult(null)
    setUploadProgress(0)
    setUploadState(createUploadState())
    setIsUploading(false)
  }

  const saveRecord = (record) => {
    setRecords((current) => saveLocalRecord(record, current))
  }

  const replaceRecords = (updater) => {
    setRecords((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return writeRecords(next)
    })
  }

  const createCollection = (form) => {
    const payload = { ...form, title: form.title.trim(), description: form.description.trim() }
    if (!payload.title) {
      setToast('请填写任务名称')
      return
    }
    apiRequest('/api/collections', { method: 'POST', body: JSON.stringify(payload) })
      .then((data) => {
        setCollectionResult({ ...data.collection, manageToken: data.manageToken })
        setCollectionManageData(null)
        saveRecord(createCollectionRecord(data.collection, 'my_collections'))
        setToast('收集任务已创建')
      })
      .catch((error) => setToast(error.message))
  }

  const openCollectionManager = async (manageUrl) => {
    setCollectionManageLoading(true)
    try {
      let token = getManageToken(manageUrl)
      if (!token) {
        const collectionToken = getCollectionToken(manageUrl)
        if (collectionToken) {
          const publicData = await apiRequest(`/api/collections/${encodeURIComponent(collectionToken)}`)
          token = getManageToken(publicData.collection?.manageUrl)
        }
      }
      if (!token) {
        setToast('管理链接无效')
        return
      }
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`)
      setCollectionManageData(data.collection)
      setActiveView('collect')
    } catch (error) {
      setToast(error.message)
    } finally {
      setCollectionManageLoading(false)
    }
  }

  const refreshCollectionManager = async () => {
    if (!collectionManageData?.manageToken) return
    const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(collectionManageData.manageToken)}`)
    setCollectionManageData(data.collection)
  }

  const lookupShare = (resolvedData) => {
    if (resolvedData?.share) {
      setRetrieveResult(resolvedData)
      saveRecord(createShareRecord(resolvedData.share, 'sent_to_me'))
      return
    }
    const code = retrievalCode.trim().toUpperCase()
    if (!code) {
      setToast('请输入取件码')
      return
    }
    apiRequest(`/api/shares/lookup/${encodeURIComponent(code)}`)
      .then((data) => {
        setRetrieveResult(data)
        saveRecord(createShareRecord(data.share, 'sent_to_me'))
      })
      .catch((error) => setToast(error.message))
  }

  const closeRetrieve = () => {
    setRetrieveOpen(false)
    setRetrieveResult(null)
    setRetrievalCode('')
  }

  const copyValue = async (value) => {
    try {
      await navigator.clipboard.writeText(value)
      setToast('已复制到剪贴板')
    } catch {
      setToast('请手动复制分享信息')
    }
  }

  const copyQrImage = async (dataUrl, fallbackText) => {
    try {
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') {
        throw new Error('copy-image-not-supported')
      }
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || 'image/png']: blob })])
      setToast('二维码图片已复制')
    } catch {
      await copyValue(fallbackText || dataUrl)
      setToast('当前浏览器不支持直接复制图片，已复制链接')
    }
  }

  const deleteRecord = (recordIds) => {
    const targets = new Set(Array.isArray(recordIds) ? recordIds : [recordIds])
    replaceRecords((current) => current.filter((record) => !targets.has(normalizeRecord(record).id)))
    setToast(targets.size > 1 ? `已删除 ${targets.size} 条记录` : '记录已删除')
  }

  const clearRecords = () => {
    replaceRecords([])
    setToast('本机记录已清空')
  }

  const refreshRecords = async ({ silent = false } = {}) => {
    const nextRecords = await syncRecords(readRecords())
    setRecords(writeRecords(nextRecords))
    if (!silent) setToast('收发记录已刷新')
  }

  const openRecordLink = (record) => {
    const url = record.manageUrl || record.shareUrl || record.publicUrl
    if (!url) {
      setToast('这条记录没有可打开的链接')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => setActiveView('send')} role="button" tabIndex={0}>
          <span className="brand-mark"><Cloud size={20} strokeWidth={2.3} /></span>
          <span className="brand-copy"><strong>鲲穹</strong><em>文件传输</em></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <NavItem icon={Send} label="发文件" active={activeView === 'send'} onClick={() => setActiveView('send')} />
          <NavItem icon={Inbox} label="收集文件" active={activeView === 'collect'} onClick={() => setActiveView('collect')} />
          <NavItem icon={History} label="收发记录" active={activeView === 'records'} onClick={() => setActiveView('records')} />
        </nav>
        <div className="topbar-actions">
          <button className="merchant-button" onClick={() => setToast('企业版将在后续版本开放')}><Sparkles size={15} /> 企业版</button>
          <button className="login-button" onClick={() => setToast('登录功能将在后续版本开放')}><UserRound size={18} /><span>登录</span><ChevronDown size={14} /></button>
          <button className="mobile-menu" aria-label="打开菜单"><Menu size={20} /></button>
        </div>
      </header>

      <main className="page-content">
        {activeView === 'send' && (
          <SendView
            files={files}
            inputRef={inputRef}
            folderInputRef={folderInputRef}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            addFiles={addFiles}
            removeFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
            uploadFiles={uploadFiles}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            uploadState={uploadState}
            shareResult={shareResult}
            settings={settings}
            onUpdateSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            onSettings={() => setSettingsOpen(true)}
            onPause={pauseUpload}
            onResume={() => uploadFiles({ resume: true })}
            onRetry={() => uploadFiles({ resume: true })}
            onReset={resetSend}
            onCopy={copyValue}
            onCopyQrImage={copyQrImage}
            onRetrieve={() => setRetrieveOpen(true)}
          />
        )}
        {activeView === 'collect' && (
          <CollectView
            result={collectionResult}
            manageData={collectionManageData}
            manageLoading={collectionManageLoading}
            records={records}
            onCreate={createCollection}
            onResetResult={() => setCollectionResult(null)}
            onRetrieve={() => setRetrieveOpen(true)}
            onCopy={copyValue}
            onCopyQrImage={copyQrImage}
            onOpenManager={openCollectionManager}
            onCloseManager={() => setCollectionManageData(null)}
            onRefreshManager={refreshCollectionManager}
            onRefreshRecords={refreshRecords}
          />
        )}
        {activeView === 'records' && <RecordsView records={records} onCopy={copyValue} onDelete={deleteRecord} onClear={clearRecords} onRefresh={refreshRecords} onOpen={openRecordLink} />}
      </main>

      <footer className="page-footer">
        <span>鲲穹文件传输 · 临时传输，轻装上阵</span>
        <div><button onClick={() => setToast('帮助中心将在正式版开放')}>帮助中心</button><button onClick={() => setToast('服务协议将在正式版开放')}>服务协议</button><button onClick={() => setToast('隐私政策将在正式版开放')}>隐私政策</button></div>
      </footer>

      {settingsOpen && <SettingsModal settings={settings} setSettings={setSettings} onClose={() => setSettingsOpen(false)} onSave={() => { setSettingsOpen(false); setToast('分享设置已保存') }} />}
      {retrieveOpen && <RetrieveModal code={retrievalCode} setCode={setRetrievalCode} result={retrieveResult} onClose={closeRetrieve} onFind={lookupShare} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function SendView({ files, inputRef, folderInputRef, isDragging, setIsDragging, addFiles, removeFile, uploadFiles, isUploading, uploadProgress, uploadState, shareResult, settings, onUpdateSettings, onSettings, onPause, onResume, onRetry, onReset, onCopy, onCopyQrImage, onRetrieve }) {
  const showUploadStatus = ['uploading', 'paused', 'failed', 'finalizing'].includes(uploadState.status)
  return (
    <>
      <section className="hero-layout">
        <aside className="side-rail side-rail-left">
          <FeatureOrb icon={Cloud} value="5 GB" label="单文件上限" tone="blue" />
          <FeatureOrb icon={Zap} value="不限速" label="原生带宽传输" tone="green" />
        </aside>
        <div className="transfer-column">
          <div className="section-intro">
            <div>
              <p className="eyebrow"><span className="eyebrow-dot" /> 不登录也能用</p>
              <h1>简单两步，<span>把文件交给他。</span></h1>
              <p className="intro-copy">拖进来，生成链接。临时传输，不占你的云盘。</p>
            </div>
            <button className="retrieve-trigger" onClick={onRetrieve}><KeyRound size={17} /><span>取件码</span><ArrowRight size={15} /></button>
          </div>
          <div className={`upload-panel ${isDragging ? 'dragging' : ''} ${files.length || shareResult ? 'has-files' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false) }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files) }}>
            <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
            <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
            {!files.length && !shareResult && <div className="empty-upload"><div className="upload-icon"><UploadCloud size={30} /></div><h2>把文件拖到这里</h2><p>支持多文件与文件夹，单次最多 100 个文件</p><div className="upload-choice"><button className="primary-button" onClick={() => inputRef.current?.click()}><FolderOpen size={17} /> 选择文件</button><button className="secondary-button" onClick={() => folderInputRef.current?.click()}><FolderOpen size={16} /> 选择文件夹</button></div><span className="upload-note">最大支持 5 GB · 分片续传 · 上传后自动生成取件码</span></div>}
            {files.length > 0 && !shareResult && (
              <div className="file-queue">
                <div className="queue-heading">
                  <div><span className="eyebrow">待发送文件</span><h2>{files.length} 个文件，准备就绪</h2></div>
                  <button className="ghost-icon" aria-label="清空文件" onClick={onReset}><X size={17} /></button>
                </div>
                <label className="delivery-field">
                  <span><Mail size={14} /> 定向发送</span>
                  <input value={settings.recipients} onChange={(event) => onUpdateSettings({ recipients: event.target.value })} placeholder="输入手机号或邮箱，多个用逗号分隔（可选）" />
                </label>
                <div className="file-list">{files.map((file) => <FileRow key={file.id} file={file} onRemove={() => removeFile(file.id)} />)}</div>
                {showUploadStatus ? <UploadProgressPanel progress={uploadProgress} uploadState={uploadState} isUploading={isUploading} onPause={onPause} onResume={onResume} onRetry={onRetry} /> : <div className="queue-actions"><button className="secondary-button" onClick={onSettings}><Settings2 size={16} /> 分享设置</button><button className="primary-button" onClick={() => uploadFiles()}><Send size={16} /> 开始上传 <ArrowRight size={15} /></button></div>}
              </div>
            )}
            {shareResult && <ShareResult result={shareResult} settings={settings} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onReset={onReset} />}
          </div>
        </div>
        <aside className="side-rail side-rail-right">
          <FeatureOrb icon={ShieldCheck} value="私密" label="安全分享" tone="orange" />
          <FeatureOrb icon={Gauge} value="快" label="上传下载不限速" tone="violet" />
        </aside>
      </section>
      <section className="value-strip"><ValueItem icon={LockKeyhole} title="无需注册" detail="即开即用，免登录发送" /><ValueItem icon={Link2} title="多种分享" detail="链接、取件码、二维码" /><ValueItem icon={Clock3} title="到期清理" detail="文件自动销毁，不留负担" /><ValueItem icon={FolderOpen} title="文件夹直传" detail="保留目录结构，不必压缩" /></section>
    </>
  )
}

function UploadProgressPanel({ progress, uploadState, isUploading, onPause, onResume, onRetry }) {
  const statusText = uploadState.status === 'paused' ? '已暂停' : uploadState.status === 'failed' ? '上传失败' : uploadState.phase || '正在上传'
  return (
    <div className={`progress-wrap enhanced-progress ${uploadState.status}`}>
      <div className="progress-label"><span>{statusText}</span><strong>{progress}%</strong></div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="upload-metrics">
        <span>已传 {formatBytes(uploadState.uploadedBytes)} / {formatBytes(uploadState.totalBytes)}</span>
        <span>速度 {uploadState.speedBps ? `${formatBytes(uploadState.speedBps)}/s` : '计算中'}</span>
        <span>剩余 {formatDuration(uploadState.etaSeconds)}</span>
      </div>
      {uploadState.currentFile && <small>当前文件：{uploadState.currentFile}</small>}
      {uploadState.retryCount > 0 && <small>已自动重试 {uploadState.retryCount} 次</small>}
      {uploadState.error && <p className="upload-error">{uploadState.error}</p>}
      <div className="upload-control-row">
        {uploadState.status === 'uploading' && <button className="secondary-button" onClick={onPause} disabled={!isUploading}><Pause size={15} /> 暂停</button>}
        {uploadState.status === 'paused' && <button className="primary-button" onClick={onResume}><Play size={15} /> 继续上传</button>}
        {uploadState.status === 'failed' && <button className="primary-button" onClick={onRetry}><RotateCcw size={15} /> 重试上传</button>}
      </div>
    </div>
  )
}

function ShareResult({ result, settings, onCopy, onCopyQrImage, onReset }) {
  const [qrOpen, setQrOpen] = useState(false)
  return (
    <>
      <div className="share-result">
        <div className="result-topline">
          <span className="success-badge"><Check size={14} /> 上传完成</span>
          <span>{formatExpiry(result.expiresAt)}</span>
        </div>
        <div className="result-main">
          <div className="result-code">
            <span>{result.code.length} 位取件码</span>
            <strong>{result.code}</strong>
            <button className="copy-button" onClick={() => onCopy(result.code)}><Copy size={14} /> 复制</button>
          </div>
          {result.qrDataUrl && (
            <button className="qr-trigger" onClick={() => setQrOpen(true)} aria-label="打开分享二维码">
              <img className="qr-image" src={result.qrDataUrl} alt="分享二维码" />
              <span>点击放大</span>
            </button>
          )}
        </div>
        <div className="share-link">
          <Link2 size={15} />
          <span>{result.shareUrl}</span>
          <button onClick={() => onCopy(result.shareUrl)} aria-label="复制分享链接"><Copy size={15} /></button>
        </div>
        {result.deliveryRecipients?.length > 0 && (
          <div className="notification-list"><Mail size={14} /><span>已生成模拟通知：{result.deliveryRecipients.join('、')}</span></div>
        )}
        <div className="result-actions">
          <button className="secondary-button" onClick={onReset}>继续发送</button>
          <button className="primary-button" onClick={() => onCopy(`${result.shareUrl} · 取件码 ${result.code}`)}><Link2 size={15} /> 分享信息</button>
        </div>
        {settings.passwordEnabled && <p className="result-security"><LockKeyhole size={14} /> 已开启提取密码保护</p>}
      </div>
      {qrOpen && (
        <QrPreviewModal
          title="分享二维码"
          detail={`取件码 ${result.code}`}
          qrDataUrl={result.qrDataUrl}
          targetUrl={result.shareUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => onCopyQrImage(result.qrDataUrl, result.shareUrl)}
          onCopyLink={() => onCopy(result.shareUrl)}
        />
      )}
    </>
  )
}

function QrPreviewModal({ title, detail, qrDataUrl, targetUrl, onClose, onCopyImage, onCopyLink }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal qr-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="qr-modal-body">
          <p className="eyebrow">二维码预览</p>
          <h2>{title}</h2>
          <p>{detail}</p>
          <img className="qr-preview-image" src={qrDataUrl} alt={title} />
          <div className="qr-preview-link"><Link2 size={14} /><span>{targetUrl}</span></div>
        </div>
        <div className="modal-footer qr-modal-footer">
          <button className="secondary-button" onClick={onCopyLink}><Copy size={15} /> 复制链接</button>
          <button className="primary-button" onClick={onCopyImage}><Copy size={15} /> 复制图片</button>
        </div>
      </div>
    </div>
  )
}

function CollectionLimitInfo({ allowedTypes, maxFileSizeMb, compact = false }) {
  return (
    <div className={`collection-limit ${compact ? 'compact' : ''}`}>
      <span>文件类型：{formatAllowedTypes(allowedTypes)}</span>
      <span>单人上限：{formatLimitSize(maxFileSizeMb)}</span>
    </div>
  )
}

function CollectView({ result, manageData, manageLoading, records, onCreate, onResetResult, onCopy, onCopyQrImage, onOpenManager, onCloseManager, onRefreshManager, onRefreshRecords }) {
  const [form, setForm] = useState(createDefaultCollectionForm)
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const collectionRecords = records.map(normalizeRecord).filter((record) => record.scope === 'my_collections')

  useEffect(() => {
    onRefreshRecords?.({ silent: true }).catch(() => {})
  }, [])

  const backToCreate = () => {
    setForm(createDefaultCollectionForm())
    onResetResult()
  }

  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> 多人文件收集</p>
          <h1>让大家把文件交到同一个地方。</h1>
          <p>创建收集任务，分享链接后，提交者无需注册即可上传。</p>
        </div>
      </div>
      {manageLoading ? (
        <div className="collection-files-card collection-loading"><span className="loading-dot" /><p>正在加载已收文件...</p></div>
      ) : manageData ? (
        <CollectionFilesPanel data={manageData} onClose={onCloseManager} onRefresh={onRefreshManager} />
      ) : (
        <div className={`collect-builder ${result ? 'created' : ''}`}>
          {!result ? (
            <>
              <div className="builder-preview">
                <div className="preview-label">收集任务预览</div>
                <div className="preview-card">
                  <span className="preview-icon"><Inbox size={20} /></span>
                  <strong>{form.title || '未命名任务'}</strong>
                  <span>{form.description || '请填写收集说明'}</span>
                  <CollectionLimitInfo allowedTypes={form.allowedTypes} maxFileSizeMb={form.maxFileSizeMb} compact />
                  <small>截止 {form.deadline || '未设置'} · 允许匿名提交</small>
                </div>
              </div>
              <div className="builder-form">
                <label>任务名称<input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：9 月产品素材收集" /></label>
                <label>收集说明<input value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="例如：请上传你负责的图片、文档或视频素材" /></label>
                <label>截止时间<input type="date" value={form.deadline} onChange={(event) => update('deadline', event.target.value)} /></label>
                <label>文件类型<div className="chip-group">{['图片', '文档', '视频', '其他'].map((type) => <button key={type} className={form.allowedTypes.includes(type) ? 'selected' : ''} onClick={() => update('allowedTypes', form.allowedTypes.includes(type) ? form.allowedTypes.filter((item) => item !== type) : [...form.allowedTypes, type])}>{type}</button>)}</div></label>
                <label>单人大小限制<select value={form.maxFileSizeMb} onChange={(event) => update('maxFileSizeMb', Number(event.target.value))}><option value="500">500 MB</option><option value="1024">1 GB</option><option value="5120">5 GB</option></select></label>
                <button className="primary-button wide" onClick={() => onCreate(form)}><Inbox size={16} /> 创建收集任务 <ArrowRight size={15} /></button>
              </div>
            </>
          ) : (
            <CollectionSuccess result={result} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onOpenManager={onOpenManager} onBack={backToCreate} />
          )}
        </div>
      )}
      {!manageData && collectionRecords.length > 0 && (
        <div className="collection-history">
          <div className="collection-history-heading">
            <div><p className="eyebrow">本机保存的任务</p><h2>我的收集任务</h2></div>
            <span>{collectionRecords.length} 个任务</span>
          </div>
          <div className="collection-history-list">
            {collectionRecords.slice(0, 6).map((record, index) => (
              <div className="collection-history-row" key={record.id || `${record.name}-${index}`}>
                <span className="record-icon collect"><Inbox size={17} /></span>
                <div>
                  <strong>{record.name}</strong>
                  <span>{record.meta}</span>
                  <CollectionLimitInfo allowedTypes={record.allowedTypes} maxFileSizeMb={record.maxFileSizeMb} compact />
                </div>
                <button className="secondary-button" disabled={!recordManageUrl(record) && !record.publicUrl && !record.shareUrl} onClick={() => onOpenManager(recordManageUrl(record) || record.publicUrl || record.shareUrl)}><FolderOpen size={15} /> 查看已收文件</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="collection-note"><ShieldCheck size={17} /><span>提交者之间互不可见，只有创建者通过管理链接查看全部文件。</span></div>
    </section>
  )
}

function CollectionSuccess({ result, onCopy, onCopyQrImage, onOpenManager, onBack }) {
  const [qrOpen, setQrOpen] = useState(false)

  return (
    <>
      <div className="collection-success">
        <span className="success-large"><Check size={27} /></span>
        <p className="eyebrow">收集任务已创建</p>
        <h2>{result.title}</h2>
        <p>分享下面的链接，参与者即可匿名提交文件。</p>
        <CollectionLimitInfo allowedTypes={result.allowedTypes} maxFileSizeMb={result.maxFileSizeMb} />
        <div className="collection-share"><Link2 size={16} /><strong>{result.publicUrl}</strong><button onClick={() => onCopy(result.publicUrl)} aria-label="复制收集链接"><Copy size={15} /></button></div>
        {result.qrDataUrl && (
          <button className="qr-trigger" onClick={() => setQrOpen(true)} aria-label="打开收集二维码">
            <img className="collection-qr" src={result.qrDataUrl} alt="收集二维码" />
            <span>点击放大</span>
          </button>
        )}
        <div className="result-actions">
          <button className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> 返回创建</button>
          <button className="secondary-button" onClick={() => onOpenManager(result.manageUrl)}><FolderOpen size={15} /> 查看已收文件</button>
          <button className="primary-button" onClick={() => onCopy(result.manageUrl)}><KeyRound size={15} /> 复制管理链接</button>
        </div>
      </div>
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail="分享链接"
          qrDataUrl={result.qrDataUrl}
          targetUrl={result.publicUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => onCopyQrImage(result.qrDataUrl, result.publicUrl)}
          onCopyLink={() => onCopy(result.publicUrl)}
        />
      )}
    </>
  )
}

function CollectionFilesPanel({ data, onClose, onRefresh }) {
  return (
    <div className="collection-files-card">
      <div className="collection-files-header">
        <div>
          <p className="eyebrow">收集任务管理</p>
          <h2>{data.title}</h2>
          <p>{data.submissions.length} 份提交 · {data.status === 'active' ? '进行中' : '已截止'}</p>
          <CollectionLimitInfo allowedTypes={data.allowedTypes} maxFileSizeMb={data.maxFileSizeMb} />
        </div>
        <div className="collection-files-actions">
          <button className="secondary-button" onClick={onClose}><ArrowLeft size={15} /> 返回任务</button>
          <button className="ghost-icon" aria-label="刷新已收文件" onClick={onRefresh}><RefreshCw size={17} /></button>
        </div>
      </div>
      {data.submissions.length ? (
        <div className="collection-submissions">
          {data.submissions.map((submission) => (
            <div className="collection-submission" key={submission.id}>
              <div className="collection-submission-heading">
                <div><strong>{submission.participantName}</strong><span>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件</span></div>
                <span className="submission-badge">已提交</span>
              </div>
              <div className="submission-files">{submission.files.map((file, fileIndex) => <div className="submission-file" key={`${submission.id}-${file.relativePath}`}><FileText size={15} /><span>{file.name}</span><small>{formatBytes(file.size)}</small><button className="ghost-icon" aria-label={`下载 ${file.name}`} onClick={() => downloadSubmissionFile(submission, fileIndex, data)}><Download size={15} /></button></div>)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-manage collection-empty"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
      )}
      {data.submissions.length > 0 && <button className="primary-button wide" onClick={() => { window.location.href = data.downloadUrl }}><Download size={16} /> 打包下载全部提交</button>}
    </div>
  )
}

function SharePage({ token }) {
  const [data, setData] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    apiRequest(`/api/shares/token/${token}`).then((result) => {
      setData(result)
      saveLocalRecord(createShareRecord(result.share, 'sent_to_me'))
    }).catch((err) => setError(err.message))
  }, [token])
  const findShare = async () => {
    try {
      const result = await apiRequest(`/api/shares/lookup/${data.share.code}`, { method: 'POST', body: JSON.stringify({ password }) })
      setData(result)
      saveLocalRecord(createShareRecord(result.share, 'sent_to_me'))
    } catch (err) { setError(err.message) }
  }
  if (error) return <PublicShell><StateBlock title="这个分享暂时不可用" detail={error} /></PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const share = data.share
  return <PublicShell><div className="public-card"><span className="public-icon"><Download size={24} /></span><p className="eyebrow">鲲穹临时分享</p><h1>有人给你发来了文件</h1><p className="public-copy">{share.files.length} 个文件 · {formatBytes(share.files.reduce((sum, file) => sum + file.size, 0))} · {formatExpiry(share.expiresAt)}</p>{data.requiresPassword && !share.files?.length ? <div className="public-password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入提取密码" /><button className="primary-button" onClick={findShare}>验证密码</button></div> : <><div className="public-files">{share.files.map((file) => <FileRow key={file.relativePath} file={file} />)}</div><button className="primary-button wide" onClick={() => downloadShare(share, password, setError)}><Download size={17} /> 下载全部文件</button></>}</div></PublicShell>
}

function CollectionSubmitPage({ token }) {
  const inputRef = useRef(null)
  const [collection, setCollection] = useState(null)
  const [files, setFiles] = useState([])
  const [name, setName] = useState('')
  const [progress, setProgress] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    apiRequest(`/api/collections/${token}`).then((data) => {
      setCollection(data.collection)
      saveLocalRecord(createCollectionRecord(data.collection, 'collect_from_me'))
    }).catch((err) => setMessage(err.message))
  }, [token])
  const submit = () => {
    const participantName = name.trim()
    if (!participantName || !files.length) { setMessage('请填写提交人名称并选择文件'); return }
    const body = new FormData()
    files.forEach((item) => body.append('files', item.file, item.name))
    body.append('participantName', participantName)
    body.append('relativePaths', JSON.stringify(files.map((item) => item.relativePath)))
    setSubmitting(true)
    xhrRequest(`/api/collections/${token}/submissions`, { method: 'POST', body, onProgress: setProgress }).then((result) => {
      const submittedAt = result.submission?.submittedAt || new Date().toISOString()
      saveLocalRecord(createCollectionRecord(collection, 'collect_from_me', { participantName, submittedAt }))
      setMessage('提交成功，感谢你的文件')
      setFiles([])
    }).catch((err) => setMessage(err.message)).finally(() => setSubmitting(false))
  }
  return (
    <PublicShell>
      <div className="public-card collection-submit-card">
        <span className="public-icon"><Inbox size={24} /></span>
        {collection ? (
          <>
            <p className="eyebrow">文件收集</p>
            <h1>{collection.title}</h1>
            <p className="public-copy">{collection.description}</p>
            <div className="deadline-line"><Clock3 size={15} /> 截止 {formatDate(collection.deadline)}</div>
            <CollectionLimitInfo allowedTypes={collection.allowedTypes} maxFileSizeMb={collection.maxFileSizeMb} />
            <label className="public-label">提交人名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：张三 / 市场部" /></label>
            <div className="public-drop" onClick={() => inputRef.current?.click()}>
              <input ref={inputRef} type="file" multiple hidden onChange={(event) => setFiles(toFileItems(event.target.files))} />
              <UploadCloud size={24} />
              <strong>{files.length ? `${files.length} 个文件已选择` : '选择要提交的文件'}</strong>
              <span>按当前任务限制提交，提交者之间互不可见</span>
            </div>
            {files.length > 0 && <div className="public-files">{files.map((file) => <FileRow key={file.id} file={file} onRemove={() => setFiles((current) => current.filter((item) => item.id !== file.id))} />)}</div>}
            {submitting && <div className="progress-wrap"><div className="progress-label"><span>正在提交...</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
            <button className="primary-button wide" onClick={submit} disabled={submitting}><UploadCloud size={17} /> {submitting ? '提交中...' : '提交文件'}</button>
            {message && <p className={`public-message ${message.includes('成功') ? 'success' : ''}`}>{message}</p>}
          </>
        ) : (
          <StateBlock title="无法打开收集任务" detail={message || '正在加载任务'} />
        )}
      </div>
    </PublicShell>
  )
}

function CollectionManagePage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiRequest(`/api/collections/manage/${token}`).then((result) => {
      setData(result.collection)
      saveLocalRecord(createCollectionRecord(result.collection, 'my_collections'))
    }).catch((err) => setError(err.message))
  }, [token])
  if (error) return <PublicShell><StateBlock title="管理链接不可用" detail={error} /></PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  return (
    <PublicShell>
      <div className="public-card manage-card">
        <p className="eyebrow">收集任务管理</p>
        <h1>{data.title}</h1>
        <p className="public-copy">{data.submissions.length} 份提交 · 状态：{data.status === 'active' ? '进行中' : '已截止'}</p>
        <CollectionLimitInfo allowedTypes={data.allowedTypes} maxFileSizeMb={data.maxFileSizeMb} />
        <div className="manage-list">
          {data.submissions.length ? data.submissions.map((submission) => (
            <div className="manage-submission" key={submission.id}>
              <div>
                <strong>{submission.participantName}</strong>
                <span>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件</span>
                <div className="manage-file-names">{submission.files.map((file, fileIndex) => <button key={`${submission.id}-${file.relativePath}`} onClick={() => downloadSubmissionFile(submission, fileIndex, data)}><FileText size={13} /> {file.name}</button>)}</div>
              </div>
              <button className="secondary-button" onClick={() => downloadSubmission(submission, data)}><Download size={15} /> 下载</button>
            </div>
          )) : (
            <div className="empty-manage"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
          )}
        </div>
        {data.submissions.length > 0 && <button className="primary-button wide" onClick={() => { window.location.href = data.downloadUrl }}><Download size={16} /> 打包下载全部提交</button>}
      </div>
    </PublicShell>
  )
}

function RetrieveModal({ code, setCode, result, onClose, onFind }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  const verify = async () => {
    try { const data = await apiRequest(`/api/shares/lookup/${code.trim().toUpperCase()}`, { method: 'POST', body: JSON.stringify({ password }) }); setError(''); onFind(data) } catch (err) { setError(err.message) }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal retrieve-modal ${result ? 'retrieve-modal-result' : ''}`} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">取件</p><h2>{result ? '文件已找到' : '输入取件码'}</h2></div><button className="ghost-icon modal-close" aria-label="关闭取件窗口" onClick={onClose}><X size={18} /></button></div><div className="modal-body">{!result ? <><p className="modal-intro">输入分享者发给你的 4-6 位取件码，开始下载文件。</p><input className="code-input" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') onFind() }} placeholder="例如 QK7P" autoFocus /><div className="retrieve-hint"><ShieldCheck size={15} /> 取件无需登录</div></> : <><p className="modal-intro">{result.requiresPassword ? '这个分享已开启提取密码，验证后即可查看文件。' : `${result.share.files.length} 个文件 · ${formatExpiry(result.share.expiresAt)}`}</p>{result.requiresPassword && <input className="modal-inline-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') verify() }} placeholder="请输入提取密码" />}{result.requiresPassword && <button className="secondary-button verify-button" onClick={verify}>验证密码</button>}{result.share.files.length > 0 && <div className="public-files compact">{result.share.files.map((file) => <FileRow key={file.relativePath} file={file} />)}</div>}{!result.requiresPassword && <button className="primary-button wide" onClick={() => downloadShare(result.share, '', setError)}><Download size={16} /> 下载全部文件</button>}{error && <p className="public-message">{error}</p>}</>}</div>{!result && <div className="modal-footer retrieve-footer"><button className="primary-button" onClick={() => onFind()}><KeyRound size={16} /> 查找文件</button></div>}</div></div>
}

function SettingsModal({ settings, setSettings, onClose, onSave }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">分享设置</p><h2>让文件按你的规则消失</h2></div>
          <button className="ghost-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="setting-block">
            <span>分享有效期</span>
            <div className="option-grid">{[['1 天', '1'], ['3 天', '3'], ['7 天', '7'], ['永久', '0']].map(([label, value]) => <button key={value} className={settings.expiryDays === value ? 'selected' : ''} onClick={() => setSettings({ ...settings, expiry: label, expiryDays: value })}>{label}{settings.expiryDays === value && <Check size={14} />}</button>)}</div>
          </div>
          <div className="setting-block">
            <span>下载次数</span>
            <div className="option-grid">{[['不限次数', 'unlimited'], ['10 次', '10'], ['1 次', '1'], ['自定义', 'custom']].map(([label, value]) => <button key={value} className={settings.downloadLimit === value ? 'selected' : ''} onClick={() => setSettings({ ...settings, downloads: label, downloadLimit: value })}>{label}{settings.downloadLimit === value && <Check size={14} />}</button>)}</div>
            {settings.downloadLimit === 'custom' && <label className="inline-setting-input"><span>最多下载次数</span><input type="number" min="1" max="9999" value={settings.customDownloadLimit} onChange={(event) => setSettings({ ...settings, customDownloadLimit: event.target.value })} placeholder="例如：5" /></label>}
          </div>
          <div className="setting-block">
            <span>取件码长度</span>
            <div className="option-grid compact-grid">{[['4 位', '4'], ['5 位', '5'], ['6 位', '6']].map(([label, value]) => <button key={value} className={settings.codeLength === value ? 'selected' : ''} onClick={() => setSettings({ ...settings, codeLength: value })}>{label}{settings.codeLength === value && <Check size={14} />}</button>)}</div>
          </div>
          <div className="switch-row"><div><strong>提取密码</strong><span>取件时需要额外输入密码</span></div><button className={`switch ${settings.passwordEnabled ? 'on' : ''}`} aria-label={settings.passwordEnabled ? '关闭提取密码' : '开启提取密码'} onClick={() => setSettings({ ...settings, passwordEnabled: !settings.passwordEnabled })}><span /></button></div>
          {settings.passwordEnabled && <label className="password-field"><span>密码内容</span><input className="modal-inline-input" type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} placeholder="例如：QK2026" /></label>}
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onSave}>保存设置</button></div>
      </div>
    </div>
  )
}

const RECORD_SCOPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'my_sent', label: '我发送的' },
  { key: 'sent_to_me', label: '发给我的' },
  { key: 'my_collections', label: '我收集的' },
  { key: 'collect_from_me', label: '向我收集的' },
]

const RECORD_DATE_FILTERS = [
  ['all', '全部日期'],
  ['today', '今天'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
  ['range', '自定义'],
]

const RECORD_STATUS_FILTERS = [
  ['all', '全部状态'],
  ['active', '有效/进行中'],
  ['expiring', '即将过期'],
  ['expired', '已过期/已截止'],
]

function RecordsView({ records, onCopy, onDelete, onClear, onRefresh, onOpen }) {
  const [scopeFilter, setScopeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [openMenu, setOpenMenu] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const normalizedRecords = records.map(normalizeRecord)
  const filteredRecords = normalizedRecords.filter((record) => (
    matchesRecordScope(record, scopeFilter)
    && matchesRecordDate(record, dateFilter, dateFrom, dateTo)
    && matchesRecordStatus(record, statusFilter)
  ))
  const visibleIds = filteredRecords.map((record) => record.id)
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length
  const allVisibleSelected = filteredRecords.length > 0 && selectedVisibleCount === filteredRecords.length
  const recordCounts = RECORD_SCOPE_TABS.reduce((acc, tab) => {
    acc[tab.key] = tab.key === 'all' ? normalizedRecords.length : normalizedRecords.filter((record) => record.scope === tab.key).length
    return acc
  }, {})

  useEffect(() => {
    handleRefresh({ silent: true }).catch(() => {})
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
    setOpenMenu(null)
  }, [scopeFilter, dateFilter, dateFrom, dateTo, statusFilter])

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

  return (
    <section className="workspace-page records-page">
      <div className="workspace-heading records-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> 你的临时空间</p>
          <h1>收发记录</h1>
          <p>按发送、接收、收集和提交归档最近活动。</p>
        </div>
      </div>

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
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="开始日期" />
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="结束日期" />
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
            <input type="checkbox" checked={allVisibleSelected} disabled={!filteredRecords.length} onChange={toggleVisibleSelection} />
            <span>已选 {selectedIds.size} 条 · 当前筛选 {filteredRecords.length} 条</span>
          </label>
          <div className="record-bulk-actions">
            <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
            <button className="secondary-button" disabled={!normalizedRecords.length} onClick={() => { onClear(); setSelectedIds(new Set()) }}><Trash2 size={15} /> 清空全部</button>
          </div>
        </div>
      </div>

      <div className="records-list enhanced-records-list">
        {filteredRecords.length ? filteredRecords.map((record) => {
          const Icon = recordIconForScope(record.scope)
          const link = recordLink(record)
          const copyTarget = recordCopyTarget(record)
          const statusGroup = recordStatusGroup(record)
          const selected = selectedIds.has(record.id)
          return (
            <div className={`record-row record-row-enhanced ${selected ? 'selected' : ''}`} key={record.id}>
              <label className="record-check" aria-label={`选择 ${record.name}`}>
                <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
              </label>
              <span className={`record-icon ${record.scope}`}><Icon size={17} /></span>
              <div className="record-main">
                <div className="record-title-line">
                  <strong>{record.name}</strong>
                  <span className="scope-pill">{recordScopeLabel(record.scope)}</span>
                </div>
                <span>{record.meta || recordDetail(record)}</span>
              </div>
              <span className="record-expiry">{recordExpiryLabel(record)}</span>
              <span className={`record-type ${statusGroup}`}>{recordDisplayStatus(record)}</span>
              <span className="record-code">{record.code || '-'}</span>
              <div className="menu-wrap row-menu-wrap">
                <button className="ghost-icon" aria-label={`更多操作：${record.name}`} onClick={(event) => toggleMenu(record.id, event)}><MoreHorizontal size={17} /></button>
                {openMenu === record.id && (
                  <div className="record-menu row-menu" onClick={(event) => event.stopPropagation()}>
                    <button disabled={!copyTarget} onClick={runMenuAction(() => onCopy(copyTarget))}><Copy size={14} /> {recordCopyLabel(record)}</button>
                    <button disabled={!link} onClick={runMenuAction(() => onOpen(record))}><ExternalLink size={14} /> 打开链接</button>
                    <button className="danger" onClick={runMenuAction(() => onDelete(record.id))}><Trash2 size={14} /> 删除记录</button>
                  </div>
                )}
              </div>
            </div>
          )
        }) : (
          <div className="empty-manage records-empty"><History size={25} /><span>没有符合当前筛选的记录</span></div>
        )}
      </div>
      <div className="records-footnote"><History size={16} /> 游客记录仅保留在当前设备，登录后可跨设备同步。</div>
    </section>
  )
}

function PublicShell({ children }) {
  return <div className="app-shell public-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span className="brand-copy"><strong>鲲穹</strong><em>文件传输</em></span></div><span className="public-safe"><ShieldCheck size={15} /> 安全临时空间</span></header><main className="public-page">{children}</main><footer className="page-footer"><span>鲲穹文件传输 · 临时传输，轻装上阵</span></footer></div>
}

function StateBlock({ title, detail }) { return <div className="state-block"><ShieldCheck size={26} /><h1>{title}</h1><p>{detail}</p><a className="primary-button" href="/">返回鲲穹首页</a></div> }
function LoadingBlock() { return <div className="state-block"><span className="loading-dot" /><h1>正在打开</h1><p>正在检查分享状态，请稍候。</p></div> }
function NavItem({ icon: Icon, label, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={2} /><span>{label}</span></button> }
function FeatureOrb({ icon: Icon, value, label, tone }) { return <div className={`feature-orb ${tone}`}><span className="orb-icon"><Icon size={21} /></span><strong>{value}</strong><span>{label}</span></div> }
function ValueItem({ icon: Icon, title, detail }) { return <div className="value-item"><span className="value-icon"><Icon size={18} /></span><div><strong>{title}</strong><span>{detail}</span></div></div> }
function FileRow({ file, onRemove }) { const Icon = fileIcon(file.name); return <div className="file-row"><span className="file-type"><Icon size={18} /></span><div className="file-info"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>{onRemove && <button className="ghost-icon" aria-label={`移除 ${file.name}`} onClick={onRemove}><X size={16} /></button>}</div> }
function toFileItems(incoming) { return Array.from(incoming || []).map((file, index) => ({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, size: file.size, relativePath: file.webkitRelativePath || file.name })) }
const RECORD_STORAGE_KEY = 'kunqiong-records'
const MAX_LOCAL_RECORDS = 100
const EXPIRING_SOON_MS = 3 * 86400000

function readRecords() {
  try {
    return normalizeRecords(JSON.parse(window.localStorage.getItem(RECORD_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

function writeRecords(records) {
  const next = normalizeRecords(records).slice(0, MAX_LOCAL_RECORDS)
  window.localStorage.setItem(RECORD_STORAGE_KEY, JSON.stringify(next))
  return next
}

function saveLocalRecord(record, currentRecords) {
  return writeRecords(upsertRecords(currentRecords || readRecords(), [record]))
}

function upsertRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  incomingRecords.map(normalizeRecord).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(merged.values()).sort(compareRecords)
}

function mergeRecord(existing, incoming) {
  const merged = { ...existing, ...incoming }
  merged.createdAt = existing.createdAt || incoming.createdAt
  merged.updatedAt = incoming.updatedAt || existing.updatedAt || new Date().toISOString()
  if ((!incoming.name || incoming.name === '文件分享') && existing.name) merged.name = existing.name
  if (!incoming.meta && existing.meta) merged.meta = existing.meta
  if (!incoming.fileCount && existing.fileCount) merged.fileCount = existing.fileCount
  if (!incoming.totalSize && existing.totalSize) merged.totalSize = existing.totalSize
  return merged
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareRecords)
}

function normalizeRecord(record = {}) {
  const now = new Date().toISOString()
  const scope = normalizeRecordScope(record.scope, record.type)
  const kind = record.kind || (scope === 'my_collections' || scope === 'collect_from_me' ? 'collection' : 'share')
  const shareId = record.shareId || getShareToken(record.shareUrl)
  const manageToken = record.manageToken || getManageToken(record.manageUrl)
  const collectionToken = record.collectionToken || getCollectionToken(record.publicUrl || record.shareUrl)
  const manageUrl = record.manageUrl || (manageToken ? `${window.location.origin}/collect/manage/${manageToken}` : '')
  const publicUrl = record.publicUrl || record.shareUrl || (collectionToken ? `${window.location.origin}/collect/${collectionToken}` : '')
  const stableToken = kind === 'share' ? (shareId || record.code) : (scope === 'my_collections' ? (manageToken || collectionToken) : (collectionToken || manageToken))
  const id = stableToken ? `${scope}:${kind}:${stableToken}` : (record.id || `${scope}:${kind}:${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const createdAt = record.createdAt || record.submittedAt || now
  const expiresAt = kind === 'share' ? (record.expiresAt || null) : null
  const deadline = kind === 'collection' ? (record.deadline || record.expiresAt || null) : null
  const normalized = {
    ...record,
    id,
    scope,
    kind,
    type: record.type || legacyTypeForScope(scope),
    name: record.name || (kind === 'collection' ? '收集任务' : '文件分享'),
    code: record.code || (kind === 'collection' ? (scope === 'collect_from_me' ? '提交入口' : '收集任务') : ''),
    shareId,
    manageToken,
    manageUrl,
    collectionToken,
    publicUrl,
    expiresAt,
    deadline,
    createdAt,
    updatedAt: record.updatedAt || record.lastSeenAt || createdAt,
  }
  normalized.status = record.status || recordDisplayStatus(normalized)
  normalized.meta = record.meta || recordDetail(normalized)
  return normalized
}

function normalizeRecordScope(scope, type) {
  if (['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'].includes(scope)) return scope
  if (type === '发送') return 'my_sent'
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

function legacyTypeForScope(scope) {
  if (scope === 'my_sent') return '发送'
  if (scope === 'sent_to_me') return '收取'
  if (scope === 'collect_from_me') return '被收集'
  return '收集'
}

function createShareRecord(share, scope = 'my_sent') {
  const files = Array.isArray(share?.files) ? share.files : []
  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  const fileLabel = files.length ? `${files.length} 个文件` : '文件未解锁'
  const recipientLabel = share?.deliveryRecipients?.length ? ` · 通知 ${share.deliveryRecipients.length} 人` : ''
  const now = new Date().toISOString()
  return normalizeRecord({
    id: `${scope}:share:${share?.id || share?.code || Date.now()}`,
    scope,
    kind: 'share',
    type: scope === 'my_sent' ? '发送' : '收取',
    name: files[0]?.name || '文件分享',
    meta: `${fileLabel}${totalSize ? ` · ${formatBytes(totalSize)}` : ''}${recipientLabel} · ${recordAgeLabel(share?.createdAt)}`,
    code: share?.code || '',
    status: share?.status === 'active' || !share?.status ? '有效' : '已过期',
    shareId: share?.id || '',
    shareUrl: share?.shareUrl || '',
    expiresAt: share?.expiresAt || null,
    downloadLimit: share?.downloadLimit,
    downloadCount: share?.downloadCount,
    fileCount: files.length,
    totalSize,
    createdAt: scope === 'sent_to_me' ? now : share?.createdAt || now,
    updatedAt: now,
  })
}

function createCollectionRecord(collection, scope = 'my_collections', extra = {}) {
  const now = new Date().toISOString()
  const submissionCount = Number(collection?.submissionCount ?? collection?.submissions?.length ?? extra.submissionCount ?? 0)
  const submittedAt = extra.submittedAt || collection?.submittedAt || ''
  const participantName = extra.participantName || collection?.participantName || ''
  const activityAt = scope === 'my_collections' ? collection?.createdAt || now : submittedAt || extra.createdAt || now
  const ownerMeta = `${submissionCount} 份提交 · ${recordAgeLabel(collection?.createdAt)}`
  const submitterMeta = submittedAt ? `${participantName || '我'} · 已提交 ${formatShortDate(submittedAt)}` : `${recordAgeLabel(activityAt)}打开 · 待提交`
  return normalizeRecord({
    id: `${scope}:collection:${scope === 'my_collections' ? (collection?.manageToken || collection?.id || collection?.token || Date.now()) : (collection?.token || collection?.id || Date.now())}`,
    scope,
    kind: 'collection',
    type: scope === 'my_collections' ? '收集' : '被收集',
    name: collection?.title || '收集任务',
    meta: scope === 'my_collections' ? ownerMeta : submitterMeta,
    code: scope === 'my_collections' ? '收集任务' : '提交入口',
    status: collection?.status === 'active' || !collection?.status ? (scope === 'my_collections' ? '进行中' : '可提交') : '已截止',
    publicUrl: collection?.publicUrl || collection?.shareUrl || '',
    shareUrl: collection?.publicUrl || collection?.shareUrl || '',
    manageUrl: collection?.manageUrl || '',
    manageToken: collection?.manageToken || getManageToken(collection?.manageUrl),
    collectionToken: collection?.token || getCollectionToken(collection?.publicUrl || collection?.shareUrl),
    deadline: collection?.deadline || null,
    allowedTypes: collection?.allowedTypes || [],
    maxFileSizeMb: collection?.maxFileSizeMb,
    submissionCount,
    participantName,
    submittedAt,
    createdAt: activityAt,
    updatedAt: now,
  })
}

function compareRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

function matchesRecordScope(record, scope) {
  return scope === 'all' || record.scope === scope
}

function matchesRecordDate(record, dateFilter, dateFrom, dateTo) {
  if (dateFilter === 'all') return true
  const date = new Date(record.createdAt)
  if (Number.isNaN(date.getTime())) return false
  const today = startOfLocalDay(new Date())
  let from = null
  let to = null
  if (dateFilter === 'today') {
    from = today
    to = addLocalDays(today, 1)
  } else if (dateFilter === '7d') {
    from = addLocalDays(today, -6)
    to = addLocalDays(today, 1)
  } else if (dateFilter === '30d') {
    from = addLocalDays(today, -29)
    to = addLocalDays(today, 1)
  }
  if (dateFilter === 'range') {
    from = parseLocalDate(dateFrom)
    const endDate = parseLocalDate(dateTo)
    to = endDate ? addLocalDays(endDate, 1) : null
  }
  if (from && date < from) return false
  if (to && date >= to) return false
  return true
}

function matchesRecordStatus(record, statusFilter) {
  const group = recordStatusGroup(record)
  return statusFilter === 'all' || group === statusFilter
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function recordStatusGroup(record) {
  if (isRecordExpired(record)) return 'expired'
  if (isRecordExpiringSoon(record)) return 'expiring'
  return 'active'
}

function isRecordExpired(record) {
  if (['已过期', '已失效', '已截止', '已关闭'].includes(record.status)) return true
  const deadline = record.expiresAt || record.deadline
  return Boolean(deadline && new Date(deadline).getTime() <= Date.now())
}

function isRecordExpiringSoon(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline || isRecordExpired(record)) return false
  return new Date(deadline).getTime() - Date.now() <= EXPIRING_SOON_MS
}

function recordDisplayStatus(record) {
  const group = recordStatusGroup(record)
  if (group === 'expired') return record.status === '已失效' ? '已失效' : record.kind === 'collection' ? '已截止' : '已过期'
  if (group === 'expiring') return '即将过期'
  if (record.kind === 'collection') return record.scope === 'collect_from_me' ? '可提交' : '进行中'
  return '有效'
}

function recordDetail(record) {
  if (record.kind === 'collection') {
    if (record.scope === 'collect_from_me') return record.submittedAt ? `${record.participantName || '我'} · 已提交 ${formatShortDate(record.submittedAt)}` : '待提交'
    return `${Number(record.submissionCount || 0)} 份提交 · ${recordAgeLabel(record.createdAt)}`
  }
  const size = Number(record.totalSize || 0)
  const count = Number(record.fileCount || 0)
  return `${count ? `${count} 个文件` : '文件分享'}${size ? ` · ${formatBytes(size)}` : ''} · ${recordAgeLabel(record.createdAt)}`
}

function recordIconForScope(scope) {
  if (scope === 'my_sent') return Send
  if (scope === 'sent_to_me') return Download
  if (scope === 'collect_from_me') return UploadCloud
  return Inbox
}

function recordScopeLabel(scope) {
  return RECORD_SCOPE_TABS.find((tab) => tab.key === scope)?.label || '记录'
}

function recordLink(record) {
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl || record.shareUrl
  return record.shareUrl || record.publicUrl || record.manageUrl
}

function recordCopyTarget(record) {
  if (record.kind === 'share') return record.code || record.shareUrl
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl
  return record.publicUrl || record.shareUrl
}

function recordManageUrl(record) {
  if (record.manageUrl) return record.manageUrl
  if (!record.manageToken) return ''
  return `${window.location.origin}/collect/manage/${record.manageToken}`
}

function recordCopyLabel(record) {
  if (record.kind === 'share') return record.code ? '复制取件码' : '复制链接'
  return record.scope === 'my_collections' ? '复制管理链接' : '复制提交链接'
}

function recordExpiryLabel(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return record.kind === 'share' ? '永久有效' : '未设置截止'
  return `${record.kind === 'collection' ? '截止' : '到期'} ${formatShortDate(deadline)}`
}

function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function createUploadState() {
  return {
    status: 'idle',
    phase: '',
    progress: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    currentFile: '',
    retryCount: 0,
    error: '',
  }
}

function createUploadSessionState() {
  return {
    sessionId: '',
    fileIndex: 0,
    chunkIndex: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    startedAt: 0,
    paused: false,
    abortCurrent: null,
  }
}

async function uploadShareInChunks(files, settings, uploadRef, onState) {
  const chunkSize = 2 * 1024 * 1024
  const session = uploadRef.current
  session.totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  session.startedAt = session.startedAt || Date.now()
  const shareOptions = buildShareOptions(settings)

  if (!session.sessionId) {
    onState({ status: 'uploading', phase: '创建上传会话', progress: 0, totalBytes: session.totalBytes, uploadedBytes: 0, speedBps: 0, etaSeconds: null, currentFile: '', retryCount: 0, error: '' })
    const response = await apiRequest('/api/upload-sessions', {
      method: 'POST',
      body: JSON.stringify({
        files: files.map((item) => ({ name: item.name, relativePath: item.relativePath, size: item.size, mimeType: item.file.type })),
        ...shareOptions,
      }),
    })
    session.sessionId = response.sessionId
  }

  for (let fileIndex = session.fileIndex; fileIndex < files.length; fileIndex += 1) {
    const item = files[fileIndex]
    const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize))
    const startChunk = fileIndex === session.fileIndex ? session.chunkIndex : 0
    for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex += 1) {
      if (session.paused) throw new UploadPausedError()
      const start = chunkIndex * chunkSize
      const end = Math.min(item.size, start + chunkSize)
      const chunk = item.file.slice(start, end)
      let attempt = 0
      while (attempt < 3) {
        try {
          onState(uploadStateFromProgress(session, session.uploadedBytes, `上传 ${item.name}`, item.name, attempt))
          await xhrUploadChunk(`/api/upload-sessions/${session.sessionId}/chunks`, {
            fileIndex,
            chunkIndex,
            totalChunks,
            chunk,
            filename: item.name,
          }, {
            uploadRef,
            onProgress: (loaded) => onState(uploadStateFromProgress(session, session.uploadedBytes + loaded, `上传 ${item.name}`, item.name, attempt)),
          })
          break
        } catch (error) {
          if (error.name === 'UploadPausedError') throw error
          attempt += 1
          onState(uploadStateFromProgress(session, session.uploadedBytes, `分片失败，正在重试`, item.name, attempt, error.message))
          if (attempt >= 3) throw error
          await wait(450 * attempt)
        }
      }
      session.uploadedBytes += end - start
      session.fileIndex = fileIndex
      session.chunkIndex = chunkIndex + 1
      onState(uploadStateFromProgress(session, session.uploadedBytes, `上传 ${item.name}`, item.name, 0))
    }
    session.fileIndex = fileIndex + 1
    session.chunkIndex = 0
  }

  onState({ status: 'finalizing', phase: '正在生成分享信息', progress: 100, uploadedBytes: session.totalBytes, totalBytes: session.totalBytes, speedBps: currentSpeed(session, session.totalBytes), etaSeconds: 0, currentFile: '', retryCount: 0, error: '' })
  return apiRequest(`/api/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ chunkSize }),
  })
}

function uploadStateFromProgress(session, loadedBytes, phase, currentFile, retryCount = 0, error = '') {
  const totalBytes = Math.max(session.totalBytes, 1)
  const speedBps = currentSpeed(session, loadedBytes)
  return {
    status: 'uploading',
    phase,
    progress: Math.min(99, Math.round((loadedBytes / totalBytes) * 100)),
    uploadedBytes: loadedBytes,
    totalBytes: session.totalBytes,
    speedBps,
    etaSeconds: speedBps ? Math.max(0, Math.round((session.totalBytes - loadedBytes) / speedBps)) : null,
    currentFile,
    retryCount,
    error,
  }
}

function currentSpeed(session, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - session.startedAt) / 1000, 0.3)
  return loadedBytes / elapsedSeconds
}

function xhrUploadChunk(url, { fileIndex, chunkIndex, totalChunks, chunk, filename }, { uploadRef, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const body = new FormData()
    body.append('fileIndex', String(fileIndex))
    body.append('chunkIndex', String(chunkIndex))
    body.append('totalChunks', String(totalChunks))
    body.append('chunk', chunk, filename)
    uploadRef.current.abortCurrent = () => xhr.abort()
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
    xhr.onload = () => {
      uploadRef.current.abortCurrent = null
      const data = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.message || '分片上传失败'))
    }
    xhr.onerror = () => {
      uploadRef.current.abortCurrent = null
      reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    }
    xhr.onabort = () => {
      uploadRef.current.abortCurrent = null
      reject(uploadRef.current.paused ? new UploadPausedError() : new Error('上传已中断'))
    }
    xhr.send(body)
  })
}

function buildShareOptions(settings) {
  const downloadLimit = settings.downloadLimit === 'custom' ? settings.customDownloadLimit : settings.downloadLimit
  return {
    expiryDays: settings.expiryDays,
    downloadLimit,
    password: settings.passwordEnabled ? settings.password : '',
    codeLength: settings.codeLength,
    recipients: settings.recipients,
  }
}

class UploadPausedError extends Error {
  constructor() {
    super('上传已暂停')
    this.name = 'UploadPausedError'
  }
}

function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)) }

async function syncRecords(records) {
  const updates = await Promise.all(normalizeRecords(records).map(syncRecord))
  return normalizeRecords(updates)
}

async function syncRecord(record) {
  if (record.kind === 'collection') return syncCollectionRecord(record)
  return syncShareRecord(record)
}

async function syncShareRecord(record) {
  const lookupUrl = record.shareId
    ? `/api/shares/token/${encodeURIComponent(record.shareId)}`
    : record.code
      ? `/api/shares/lookup/${encodeURIComponent(record.code)}`
      : ''
  if (!lookupUrl) return record
  try {
    const data = await apiRequest(lookupUrl)
    const refreshed = createShareRecord(data.share, record.scope)
    refreshed.createdAt = record.createdAt || refreshed.createdAt
    refreshed.updatedAt = record.updatedAt || refreshed.updatedAt
    return mergeRecord(record, refreshed)
  } catch (error) {
    return markRecordUnavailable(record, error.message)
  }
}

async function syncCollectionRecord(record) {
  const manageToken = record.manageToken || getManageToken(record.manageUrl)
  const collectionToken = record.collectionToken || getCollectionToken(record.publicUrl || record.shareUrl)
  const lookupUrl = record.scope === 'my_collections' && manageToken
    ? `/api/collections/manage/${encodeURIComponent(manageToken)}`
    : collectionToken
      ? `/api/collections/${encodeURIComponent(collectionToken)}`
      : manageToken
        ? `/api/collections/manage/${encodeURIComponent(manageToken)}`
        : ''
  if (!lookupUrl) return record
  try {
    const data = await apiRequest(lookupUrl)
    const refreshed = createCollectionRecord(data.collection, record.scope, {
      participantName: record.participantName,
      submittedAt: record.submittedAt,
    })
    refreshed.createdAt = record.createdAt || refreshed.createdAt
    refreshed.updatedAt = record.updatedAt || refreshed.updatedAt
    return mergeRecord(record, refreshed)
  } catch (error) {
    return markRecordUnavailable(record, error.message)
  }
}

function markRecordUnavailable(record, message = '') {
  if (!/过期|失效|不存在|用完|关闭|截止|不可用/.test(message)) return record
  return {
    ...record,
    status: record.kind === 'collection' ? '已截止' : '已失效',
    updatedAt: new Date().toISOString(),
  }
}

function getUrlParts(value) {
  if (!value) return []
  try {
    return new URL(value, window.location.origin).pathname.split('/').filter(Boolean)
  } catch {
    return []
  }
}

function getShareToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'share' ? parts[1] || '' : ''
}

function getCollectionToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'collect' && parts[1] !== 'manage' ? parts[1] || '' : ''
}

function getManageToken(value) {
  const parts = getUrlParts(value)
  const index = parts.indexOf('manage')
  return index >= 0 ? parts[index + 1] || '' : ''
}
function recordAgeLabel(createdAt) {
  if (!createdAt) return '已更新'
  const elapsedMinutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (elapsedMinutes < 1) return '刚刚创建'
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前创建`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} 小时前创建`
  return `${Math.floor(elapsedHours / 24)} 天前创建`
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || '请求失败')
  return data
}

function xhrRequest(url, { method = 'POST', body, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)) }
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.message || '上传失败'))
    }
    xhr.onerror = () => reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    xhr.send(body)
  })
}

async function downloadShare(share, password, setError) {
  try {
    const response = await fetch(share.downloadUrl, { headers: password ? { 'x-share-password': password } : {} })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || '下载失败')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = share.files.length === 1 ? share.files[0].name : '鲲穹文件包.zip'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) { setError(error.message) }
}

async function downloadSubmission(submission, collection) {
  if (submission.files.length === 1) {
    downloadSubmissionFile(submission, 0, collection)
    return
  }
  window.location.href = collection.downloadUrl
}

function downloadSubmissionFile(submission, fileIndex, collection) {
  const url = `${window.location.origin}/api/collections/manage/${collection.manageToken}/submissions/${submission.id}/files/${fileIndex}/download`
  window.location.href = url
}

function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
function formatAllowedTypes(types) {
  return Array.isArray(types) && types.length ? types.join('、') : '不限类型'
}
function formatLimitSize(value) {
  const mb = Number(value || 0)
  if (!mb) return '不限大小'
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(1))} GB`
  return `${mb} MB`
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '计算中'
  if (seconds <= 0) return '即将完成'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}
function formatExpiry(value) { return value ? `有效期至 ${new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '永久有效' }
function formatDate(value) { return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function defaultDeadline(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }

createRoot(document.getElementById('root')).render(<App />)

