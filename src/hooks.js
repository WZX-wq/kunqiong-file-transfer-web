// 由 main.jsx 抽取（2026-10-09）
//
import { useEffect, useRef, useState } from 'react'
import {
  createDownloadState, downloadBinaryWithProgress, isDownloadBusy, upgradeApiRequest,
} from './lib/api.js'

export function useConfirmDialog() {
  const [confirmState, setConfirmState] = useState(null)
  const resolverRef = useRef(null)

  useEffect(() => () => {
    if (resolverRef.current) resolverRef.current(false)
  }, [])

  const requestConfirm = (options = {}) => new Promise((resolve) => {
    resolverRef.current = resolve
    setConfirmState({
      eyebrow: '操作确认',
      confirmText: '确定',
      cancelText: '取消',
      tone: 'default',
      ...options,
    })
  })

  const settleConfirm = (confirmed) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setConfirmState(null)
    resolve?.(confirmed)
  }

  return { confirmState, requestConfirm, settleConfirm }
}

// 远端主站套餐实价（与订单支付同源）：拉取失败或非远端来源时返回 null，调用方沿用本地展示价兜底。
export function useRemotePlanPricing(enabledId) {
  const [remotePricing, setRemotePricing] = useState(null)
  useEffect(() => {
    if (!enabledId) return undefined
    let cancelled = false
    upgradeApiRequest('/api/account/upgrade-pricing').then((data) => {
      if (!cancelled && data?.source === 'remote') setRemotePricing(data.pricing || {})
    }).catch(() => { /* 拉不到远端价就沿用本地展示价 */ })
    return () => { cancelled = true }
  }, [enabledId])
  return remotePricing
}

export function useDownloadTask() {
  const [downloadTask, setDownloadTask] = useState(createDownloadState())
  const activeRef = useRef(false)
  const retryConfigRef = useRef(null)
  const retryCountRef = useRef(0)

  const startDownload = async (config, options = {}) => {
    if (!config) return { ok: false, error: '下载链接不可用' }
    if (activeRef.current) return { ok: false, error: '已有下载正在进行，请稍候' }
    activeRef.current = true
    retryConfigRef.current = config
    retryCountRef.current = options.retry ? retryCountRef.current + 1 : 0
    const retryCount = retryCountRef.current
    setDownloadTask({ ...createDownloadState(), status: 'preparing', label: config.label, filename: config.filename, totalBytes: config.totalBytes || 0, retryCount, retryConfig: config })
    try {
      const result = await downloadBinaryWithProgress(config, (patch) => {
        setDownloadTask((current) => ({ ...current, ...patch, retryConfig: config, retryCount }))
      })
      setDownloadTask((current) => ({ ...current, status: result?.handedOff ? 'handed_off' : 'complete', progress: result?.handedOff ? 0 : 100, etaSeconds: 0, error: '', retryConfig: config, retryCount }))
      return { ok: true }
    } catch (error) {
      const message = error.message || '下载失败'
      setDownloadTask((current) => ({ ...current, status: 'failed', error: message, retryConfig: config, retryCount }))
      return { ok: false, error: message }
    } finally {
      activeRef.current = false
    }
  }

  const retryDownload = () => {
    const config = retryConfigRef.current || downloadTask.retryConfig
    if (config) startDownload(config, { retry: true })
  }

  return { downloadTask, startDownload, retryDownload, downloadBusy: isDownloadBusy(downloadTask) }
}
