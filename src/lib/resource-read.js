import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_SESSION_EVENT, apiRequest, getCachedAccountSession } from './api.js'

// Resource errors belong to the account that received them. Switching accounts
// must discard both that account's private data and any old permission error.
export function useResourceRead(url, onLoad, onReset) {
  const callbacks = useRef({ onLoad, onReset })
  callbacks.current = { onLoad, onReset }
  const owner = useRef(getCachedAccountSession()?.user?.id || '')
  const pending = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const changed = event => {
      const next = event.detail?.userId || ''
      if (next === owner.current) return
      owner.current = next
      pending.current?.abort()
      callbacks.current.onReset?.()
      setError(null)
      setAttempt(value => value + 1)
    }
    window.addEventListener(ACCOUNT_SESSION_EVENT, changed)
    return () => window.removeEventListener(ACCOUNT_SESSION_EVENT, changed)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    pending.current = controller
    setError(null)
    setLoading(true)
    apiRequest(url, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) callbacks.current.onLoad(result)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [url, attempt])
  return { error, loading, retry: () => setAttempt(value => value + 1) }
}
