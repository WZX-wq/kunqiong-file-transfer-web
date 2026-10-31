const ALIPAY_DOMAINS = ['alipay.com', 'alipaydev.com']

function trustedAlipayUrl(value, baseUrl) {
  let url
  try {
    url = new URL(value, baseUrl)
  } catch {
    throw new Error('支付宝收银台地址无效，请重新加载支付信息')
  }
  const host = url.hostname.toLowerCase()
  const trustedHost = ALIPAY_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))
  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('支付宝收银台地址未通过安全校验，请重新加载支付信息')
  }
  return url.href
}

function readHiddenFields(form) {
  const inputs = [...form.querySelectorAll('input')]
  if (form.querySelector('select, textarea') || inputs.some(input => input.name && !['hidden', 'submit', 'button'].includes((input.type || 'text').toLowerCase()))) {
    throw new Error('支付宝支付表单包含不支持的字段，请重新加载支付信息')
  }
  const fields = inputs
    .filter(input => input.name && !input.disabled && (input.type || 'text').toLowerCase() === 'hidden')
    .map(input => ({ name: input.name, value: input.value }))
  if (fields.length > 100 || fields.some(field => !/^[\w.-]{1,128}$/.test(field.name) || field.value.length > 100_000)) {
    throw new Error('支付宝支付表单字段无效，请重新加载支付信息')
  }
  return fields
}

export function parseAlipayCheckout(html, { baseUrl = 'https://excashier.alipay.com/', Parser = globalThis.DOMParser } = {}) {
  if (typeof html !== 'string' || !html.trim() || html.length > 2_000_000) {
    throw new Error('支付宝收银台内容无效，请重新加载支付信息')
  }
  if (typeof Parser !== 'function') throw new Error('当前浏览器无法解析支付宝收银台，请更新浏览器后重试')

  const parsed = new Parser().parseFromString(html, 'text/html')
  const baseHref = parsed.querySelector('base[href]')?.getAttribute('href')
  const form = parsed.querySelector('form')
  if (form) {
    const actionValue = form.getAttribute('action') || baseHref
    if (!actionValue) throw new Error('支付宝未返回可用的支付表单，请重新加载支付信息')
    const action = trustedAlipayUrl(actionValue, baseHref || baseUrl)
    const method = (form.getAttribute('method') || 'GET').toUpperCase()
    if (!['GET', 'POST'].includes(method)) throw new Error('支付宝支付表单方式无效，请重新加载支付信息')
    const fields = readHiddenFields(form)
    if (method === 'GET') {
      const url = new URL(action)
      for (const field of fields) url.searchParams.append(field.name, field.value)
      return { method, url: url.href, fields: [] }
    }
    return { method, url: action, fields }
  }

  const redirect = parsed.querySelector('iframe[src]')?.getAttribute('src')
    || parsed.querySelector('meta[http-equiv="refresh" i]')?.content?.match(/url\s*=\s*([^;]+)/i)?.[1]
  const checkoutUrl = redirect || baseHref
  if (!checkoutUrl) throw new Error('支付宝未返回可用的收银台地址，请重新加载支付信息')
  return { method: 'GET', url: trustedAlipayUrl(checkoutUrl, baseUrl), fields: [] }
}
