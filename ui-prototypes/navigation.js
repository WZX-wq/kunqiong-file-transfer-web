const transitionKey = 'kq-ui-prototype-route-transition'
const prototypePath = pathname => pathname === '/index.html' || /^\/(a|b|c|d)\//.test(pathname)
let leaving = false

const routeKey = url => `${url.pathname}${url.search}${url.hash}`

function consumeArrival() {
  if (typeof window === 'undefined') return false
  try {
    const expected = sessionStorage.getItem(transitionKey)
    sessionStorage.removeItem(transitionKey)
    return expected === routeKey(new URL(location.href))
  } catch {
    return false
  }
}

export const routeArriving = consumeArrival()

export function navigateTo(destination) {
  const target = new URL(destination, location.href)
  if (target.origin !== location.origin || leaving) return
  if (routeKey(target) === routeKey(new URL(location.href))) return

  const app = document.querySelector('.app')
  if (!app || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    location.assign(target.href)
    return
  }

  try {
    sessionStorage.setItem(transitionKey, routeKey(target))
  } catch {
    // Navigation still works if storage is unavailable.
  }

  leaving = true
  app.classList.add('route-leaving')

  let finished = false
  const onAnimationEnd = event => {
    if (event.target !== app || event.animationName !== 'prototype-route-exit') return
    clearTimeout(timeout)
    app.removeEventListener('animationend', onAnimationEnd)
    finish()
  }
  const finish = () => {
    if (finished) return
    finished = true
    app.removeEventListener('animationend', onAnimationEnd)
    location.assign(target.href)
  }
  const timeout = setTimeout(finish, 460)
  app.addEventListener('animationend', onAnimationEnd)
}

export function installPrototypeNavigation() {
  const onClick = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = event.target?.closest?.('a[href]')
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return

    const target = new URL(anchor.href, location.href)
    if (target.origin !== location.origin || !prototypePath(target.pathname)) return
    if (routeKey(target) === routeKey(new URL(location.href))) return

    event.preventDefault()
    navigateTo(target.href)
  }

  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
