import React, { Children, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function PlanCarousel({ children, className }) {
  const track = useRef(null)
  const trackId = useId()
  const count = Children.count(children)
  const [scroll, setScroll] = useState({ previous: false, next: false })
  const hasOverflow = scroll.previous || scroll.next

  const updateScroll = useCallback(() => {
    const element = track.current
    if (!element) return
    const previous = element.scrollLeft > 1
    const next = element.scrollWidth - element.clientWidth - element.scrollLeft > 1
    setScroll(current => current.previous === previous && current.next === next ? current : { previous, next })
  }, [])

  useEffect(() => {
    updateScroll()
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(updateScroll) : null
    if (track.current) observer?.observe(track.current)
    window.addEventListener('resize', updateScroll)
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateScroll) }
  }, [count, updateScroll])

  const move = (direction) => {
    const element = track.current
    if (!element) return
    const card = element.firstElementChild
    const distance = card ? card.getBoundingClientRect().width + parseFloat(window.getComputedStyle(element).columnGap || '0') : element.clientWidth
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    element.scrollBy({ left: direction * distance, behavior })
  }

  return (
    <div className="plan-carousel">
      <div className="workspace-plan-catalog-heading">
        <strong>个人套餐价格</strong>
        <div className="plan-carousel-nav" hidden={!hasOverflow}>
          <button type="button" aria-label="向左查看套餐" aria-controls={trackId} disabled={!scroll.previous} onClick={() => move(-1)}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="向右查看套餐" aria-controls={trackId} disabled={!scroll.next} onClick={() => move(1)}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div id={trackId} ref={track} className={`plan-carousel-track ${className}`} role="group" aria-label="选择套餐" tabIndex={hasOverflow ? 0 : undefined} onScroll={updateScroll} onKeyDown={event => {
        if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault()
        move(event.key === 'ArrowLeft' ? -1 : 1)
      }}>
        {children}
      </div>
    </div>
  )
}
