import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { parseAlipayCheckout } from '../src/lib/alipay-checkout.js'

const parserWindow = new JSDOM('').window
const parse = html => parseAlipayCheckout(html, { Parser: parserWindow.DOMParser })

test('extracts the provider cashier URL for a cross-origin inline iframe', () => {
  const checkout = parse('<base href="https://excashier.alipay.com/standard/auth.htm?payOrderId=fixture"><script>window.compromised = true</script>')
  assert.deepEqual(checkout, { method: 'GET', url: 'https://excashier.alipay.com/standard/auth.htm?payOrderId=fixture', fields: [] })
})

test('preserves Alipay GET form fields in the validated cashier URL', () => {
  const checkout = parse('<form method="get" action="https://excashier.alipay.com/standard/auth.htm"><input type="hidden" name="payOrderId" value="fixture-order"></form>')
  assert.equal(checkout.method, 'GET')
  assert.equal(checkout.url, 'https://excashier.alipay.com/standard/auth.htm?payOrderId=fixture-order')
  assert.deepEqual(checkout.fields, [])
})

test('returns only hidden POST fields for a trusted Alipay form', () => {
  const checkout = parse('<form method="post" action="https://openapi.alipay.com/gateway.do"><input type="hidden" name="biz_content" value="signed-value"><script>window.compromised = true</script></form>')
  assert.deepEqual(checkout, { method: 'POST', url: 'https://openapi.alipay.com/gateway.do', fields: [{ name: 'biz_content', value: 'signed-value' }] })
})

test('rejects untrusted URLs, active fields, and unsupported methods', () => {
  assert.throws(() => parse('<base href="https://attacker.example/collect">'), /未通过安全校验/)
  assert.throws(() => parse('<base href="http://excashier.alipay.com/standard/auth.htm">'), /未通过安全校验/)
  assert.throws(() => parse('<form action="https://openapi.alipay.com/gateway.do"><input name="account" value="x"></form>'), /不支持的字段/)
  assert.throws(() => parse('<form method="put" action="https://openapi.alipay.com/gateway.do"></form>'), /表单方式无效/)
  parserWindow.close()
})
