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
    resolverRef.current?.(false)
    resolverRef.current = null
  }, [])

  const requestConfirm = (options = {}) => new Promise((resolve) => {
    resolverRef.current?.(false)
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

// Remote availability is explicit; do not present a fallback price as purchasable.
export function useRemotePlanPricing(enabledId) {
  const [remotePricing, setRemotePricing] = useState(null)
  useEffect(() => {
    setRemotePricing(null)
    if (!enabledId) return undefined
    let cancelled = false
    upgradeApiRequest('/api/account/upgrade-pricing').then((data) => {
      if (!cancelled) setRemotePricing(data?.source === 'remote' ? data.pricing || {} : { error: '套餐价格暂不可用，请稍后重试' })
    }).catch(() => {
      if (!cancelled) setRemotePricing({ error: '套餐价格加载失败，请稍后重试' })
    })
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
      const needsPassword = [401, 403].includes(error.status) && /提取密码/.test(message)
      setDownloadTask((current) => ({ ...current, status: 'failed', needsPassword, error: message, retryConfig: config, retryCount }))
      return { ok: false, error: message }
    } finally {
      activeRef.current = false
    }
  }

  const retryDownload = (password) => {
    const config = retryConfigRef.current || downloadTask.retryConfig
    if (config) return startDownload(typeof password === 'string' ? { ...config, headers: { ...config.headers, 'x-share-password': password } } : config, { retry: true })
  }

  return { downloadTask, startDownload, retryDownload, downloadBusy: isDownloadBusy(downloadTask) }
}
