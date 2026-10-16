import { useEffect, useRef, useState } from 'react'
import { accountSessionKey } from './api.js'

export function useSerializedPreference(value, ownerId, normalize, save, onSaved) {
  const sourceKey = JSON.stringify(normalize(value))
  const [state, setState] = useState(() => normalize(value))
  const [error, setError] = useState('')
  const ref = useRef({ ownerId, desired:state, confirmed:state, version:0, settled:0, queue:Promise.resolve() })
  const callback = useRef(onSaved)
  const mounted = useRef(false)
  callback.current = onSaved
  if (ref.current.ownerId !== ownerId) ref.current = { ownerId, desired:normalize(value), confirmed:normalize(value), version:0, settled:0, queue:Promise.resolve() }
  useEffect(() => {
    if (ref.current.ownerId !== ownerId) ref.current = { ownerId, desired:normalize(value), confirmed:normalize(value), version:0, settled:0, queue:Promise.resolve() }
    const entry = ref.current
    if (entry.version === entry.settled) {
      entry.desired = entry.confirmed = normalize(value)
      setState(entry.desired)
      setError('')
    }
  }, [sourceKey, ownerId, normalize])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const update = change => {
    const entry = ref.current
    if (!entry || entry.ownerId !== ownerId) return
    const next = normalize(typeof change === 'function' ? change(entry.desired) : { ...entry.desired, ...change })
    entry.desired = next
    const version = ++entry.version
    const sessionKey = accountSessionKey()
    setState(next)
    setError('')
    entry.queue = entry.queue.catch(() => {}).then(async () => {
      // The component may unmount while a preference is queued (for example
      // when switching settings sections). Keep the request going so the last
      // user action is not silently lost; the identity check still prevents an
      // old account's queued write from crossing into a new account.
      if (ref.current !== entry || accountSessionKey() !== sessionKey) return
      try {
        const data = await save(next)
        entry.confirmed = normalize(data.settings)
        if (mounted.current && ref.current === entry && accountSessionKey() === sessionKey && version === entry.version) {
          entry.settled = version
          entry.desired = entry.confirmed
          setState(entry.confirmed)
          callback.current?.(entry.confirmed)
        }
      } catch (failure) {
        if (mounted.current && ref.current === entry && accountSessionKey() === sessionKey && version === entry.version) {
          entry.settled = version
          entry.desired = entry.confirmed
          setState(entry.confirmed)
          setError(failure.message || '设置保存失败，请重试')
        }
      }
    })
  }
  return [state, update, error]
}
