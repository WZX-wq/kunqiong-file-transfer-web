// A state can be exchanged once. Bound callbacks that arrive while that exchange
// is running join it, instead of consuming the code again or reporting expiry.
export class OAuthCallbackRegistry {
  constructor({ ttlMs = 600000, now = Date.now } = {}) {
    this.entries = new Map()
    this.ttlMs = ttlMs
    this.now = now
  }

  get(state, browserHash) {
    const entry = this.entries.get(state)
    if (!entry || entry.browserHash !== browserHash || entry.delivered) return null
    if (this.now() - entry.startedAt >= this.ttlMs) {
      this.entries.delete(state)
      return null
    }
    return entry
  }

  start(state, browserHash, claim, run) {
    for (const [key, entry] of this.entries) if (this.now() - entry.startedAt >= this.ttlMs) this.entries.delete(key)
    if (this.entries.has(state)) return this.get(state, browserHash)
    const pending = claim()
    if (!pending) return null
    const entry = { browserHash, pending, startedAt: this.now(), delivered: false, result: null }
    // Install before running any provider I/O so parallel callbacks cannot race.
    this.entries.set(state, entry)
    entry.completion = Promise.resolve().then(() => run(pending)).then(result => {
      entry.result = result
      return result
    })
    return entry
  }
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

export function oauthPendingPage(state) {
  const target = escapeHtml(`/auth/pending?state=${encodeURIComponent(state)}`)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在完成登录 · 鲲穹文件传输</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f5f8fc;color:#17233a;font:16px system-ui,sans-serif}main{box-sizing:border-box;width:min(440px,calc(100% - 48px));min-height:260px;padding:36px;background:white;border:1px solid #dee7f3;border-radius:20px;text-align:center}h1{font-size:22px;margin:20px 0 12px}p{color:#66768c;line-height:1.8}span{display:inline-block;width:28px;height:28px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){span{animation:none}}</style><script src="/auth/progress.js" defer></script></head><body><main aria-live="polite"><span aria-hidden="true"></span><h1>正在完成登录</h1><p>正在确认账户并保存登录状态<br>页面会自动跳转，请勿重复授权</p><noscript><a href="${target}">检查登录结果</a></noscript></main></body></html>`
}

// Keep one document and one poll in flight. The result contains only a bound
// same-origin delivery URL; the session credential never enters JavaScript.
export const oauthProgressScript = `(() => {
  const state = new URLSearchParams(location.search).get('state') || '';
  const endpoint = '/api/auth/progress?state=' + encodeURIComponent(state);
  async function poll() {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (result.ready || response.status === 410) {
        location.replace('/auth/pending?state=' + encodeURIComponent(state));
        return;
      }
    } catch {}
    setTimeout(poll, 1000);
  }
  poll();
})();`
