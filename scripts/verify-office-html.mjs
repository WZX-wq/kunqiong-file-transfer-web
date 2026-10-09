import assert from 'node:assert/strict'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { sanitizeOfficeHtml } from '../src/office-html.js'

const window = new JSDOM('').window
const purifier = createDOMPurify(window)
const html = sanitizeOfficeHtml('<table><tr><td>safe</td></tr></table><a href="javascript:alert(1)">x</a><a href="java&#x73;cript:alert(1)">y</a><a href="data:text/html,evil">z</a><a href="https://example.com">safe link</a><img src="data:image/png;base64,YQ==" onerror="alert(1)"><script>alert(1)</script><iframe src="https://evil.example"></iframe><form><input name="location"></form>', purifier)
const document = new JSDOM(html).window.document
assert.equal(document.querySelectorAll('script,iframe,form,input,[onerror]').length, 0)
assert.equal(document.querySelectorAll('a[href]').length, 1)
assert.equal(document.querySelector('a[href]').href, 'https://example.com/')
assert.equal(document.querySelector('td').textContent, 'safe')
assert.equal(document.querySelector('img').getAttribute('src'), 'data:image/png;base64,YQ==')
console.log('Office HTML sanitizer: unsafe schemes and active elements removed; text, tables and embedded images preserved.')
window.close()
