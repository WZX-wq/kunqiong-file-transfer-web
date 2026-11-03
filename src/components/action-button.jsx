import React, { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react'
import './action-button.css'

const FormPending = createContext(false)

// A ref closes the gap before React renders disabled, including two clicks in
// the same event loop. Hold the lock through confirmations and follow-up reads.
function usePendingAction(handler) {
  const running = useRef(false)
  const mounted = useRef(true)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const run = event => {
    if (running.current) { event.preventDefault(); return }
    running.current = true
    const finish = () => {
      running.current = false
      if (mounted.current) setPending(false)
    }
    let result
    try { result = handler?.(event) }
    catch (error) { finish(); throw error }
    if (!result || typeof result.then !== 'function') { finish(); return result }
    setPending(true)
    // Callers own their error messages. Observe both outcomes to always unlock
    // and avoid an unhandled rejection from a DOM event's ignored return value.
    void Promise.resolve(result).then(finish, finish)
    return result
  }
  return { pending, run }
}

export const ActionButton = forwardRef(function ActionButton({ onClick, disabled, type, children, ...props }, ref) {
  const formPending = useContext(FormPending)
  const { pending, run } = usePendingAction(onClick)
  const busy = pending || (formPending && (!type || type === 'submit'))
  return <button {...props} ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || props['aria-busy'] || undefined} onClick={onClick ? run : undefined}>
    {children}
    {busy && <span className="action-pending-status" role="status" aria-label="正在处理，请稍候" />}
  </button>
})

export const ActionForm = forwardRef(function ActionForm({ onSubmit, children, ...props }, ref) {
  const { pending, run } = usePendingAction(onSubmit)
  return <FormPending.Provider value={pending}>
    <form {...props} ref={ref} aria-busy={pending || undefined} onSubmit={run}>{children}</form>
  </FormPending.Provider>
})
