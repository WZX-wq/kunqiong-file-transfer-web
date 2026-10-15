import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

export function SecurityCheckStatus({ startedAt, stage = 'scanning', currentFile = '', fileIndex = 0, fileCount = 0, completedCount = 0, activeCount = 1, connectionMessage = '' }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const start = new Date(startedAt).getTime()
  const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0
  const elapsed = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  const publishing = stage === 'publishing'
  return <div className="security-check-status">
    <div className="security-check-heading" role="status">
      <ShieldCheck size={17} className={connectionMessage ? '' : 'security-check-pulse'} />
      <strong>{connectionMessage ? '正在恢复连接' : publishing ? '安全检查通过，正在完成发布' : '正在进行安全检查'}</strong>
      <span aria-label="处理已等待时间">已等待 {elapsed}</span>
    </div>
    {fileCount > 1 && !publishing && <p>已检查 {completedCount} / {fileCount} 个文件{activeCount > 1 ? ` · ${activeCount} 个文件处理中` : ''}</p>}
    {currentFile && <p className="security-check-file">当前检查{fileCount > 1 ? `（第 ${fileIndex} 个）` : ''}：{currentFile}</p>}
    <p>{connectionMessage || (publishing ? '正在保存文件并生成分享信息，请稍候。' : '上传已完成。大文件或压缩包需要解压检查，可能耗时数分钟；检查通过后自动完成。')}</p>
    {seconds >= 60 && !publishing && !connectionMessage && <p>检查仍在进行，页面会自动查询结果，无需重新上传。</p>}
  </div>
}
