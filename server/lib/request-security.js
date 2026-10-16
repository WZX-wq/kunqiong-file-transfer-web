import proxyAddress from 'proxy-addr'
import { configuredAppUrl, configuredCallbackUrls, serverHost, serverPort, trustedProxyAddresses } from '../config.js'

const trustAddress = proxyAddress.compile(trustedProxyAddresses)

export function clientAddress(req) {
  // Forwarded identity is accepted only from explicitly configured proxy
  // addresses. Walk from the socket inward and stop at the first untrusted hop.
  // With no configured proxy, a direct caller cannot rotate its quota using XFF.
  const peer = String(req.socket?.remoteAddress || 'unknown')
  if (!trustedProxyAddresses.length || !trustAddress(peer)) return peer.replace(/^::ffff:/, '')
  try { return proxyAddress({ ...req, socket:req.socket, headers:req.headers || {} }, trustAddress).replace(/^::ffff:/, '') }
  catch { return peer.replace(/^::ffff:/, '') }
}

export function localRequest(req) {
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  return ['127.0.0.1', '::1'].includes(ip) && ['127.0.0.1', 'localhost', '::1'].includes(serverHost)
}

export function allowedOrigins(req) {
  const origins = new Set()
  for (const value of [configuredAppUrl, ...configuredCallbackUrls]) {
    try { const url = new URL(value); if (/^https?:$/.test(url.protocol)) origins.add(url.origin) } catch {}
  }
  if (localRequest(req)) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      for (const port of [serverPort, 4173, 4180]) origins.add(`http://${host}:${port}`)
    }
  }
  return origins
}

export function requestOrigin(req) {
  const allowed = allowedOrigins(req)
  const direct = `${req.protocol || 'http'}://${req.get('host') || ''}`
  if (allowed.has(direct)) return direct
  if (localRequest(req)) {
    const forwarded = `${String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()}://${String(req.get('x-forwarded-host') || '').split(',')[0].trim()}`
    if (allowed.has(forwarded)) return forwarded
  }
  try { if (configuredAppUrl) return new URL(configuredAppUrl).origin } catch {}
  return [...allowed][0] || `http://localhost:${serverPort}`
}
