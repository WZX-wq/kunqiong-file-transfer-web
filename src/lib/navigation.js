// Keep ordinary app navigation in React; external/auth/download links stay native.
export const BEFORE_APP_NAVIGATION = 'kunqiong:before-navigation'

export function isAppRoute(url) {
  return url.origin === window.location.origin && (
    /^\/(?:$|workspace\/?$|team\/?$|trash\/?$|settings(?:\/[^/?#]+)*\/?$|orders\/?$)/.test(url.pathname)
    || /^\/(?:share\/(?:manage\/)?[^/]+|collect\/(?:manage\/)?[^/]+|e\/[^/]+(?:\/(?:share|collect)(?:\/[^/]+)?)?)\/?$/.test(url.pathname)
  )
}

export function navigateApp(href) {
  const url = new URL(href, window.location.href)
  if (!isAppRoute(url) || !isAppRoute(new URL(window.location.href))) { window.location.href = url.href; return }
  if (url.pathname.startsWith('/orders')) url.pathname = '/settings/orders'
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const next = `${url.pathname}${url.search}${url.hash}`
  if (current === next) return
  if (!window.dispatchEvent(new CustomEvent(BEFORE_APP_NAVIGATION, { cancelable: true, detail: { url } }))) return
  window.history.pushState(null, '', next)
  window.dispatchEvent(new PopStateEvent('popstate'))
  document.documentElement.scrollTop = 0
}

export function handleAppLink(event) {
  if (!isAppRoute(new URL(window.location.href))) return
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.target.closest?.('a[href]')
  if (!link || link.hasAttribute('download') || link.hasAttribute('data-native-navigation') || (link.target && link.target !== '_self') || link.relList.contains('external')) return
  const url = new URL(link.href, window.location.href)
  if (!isAppRoute(url) || (url.pathname === window.location.pathname && url.search === window.location.search && url.hash)) return
  event.preventDefault()
  navigateApp(url.href)
}
