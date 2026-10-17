import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSpaDocument, resolveSeo, robotsTxt, sitemapXml } from '../server/services/seo.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const request = pathname => ({
  path: pathname,
  protocol: 'http',
  headers: { host: 'localhost:8045' },
  get(name) { return this.headers[String(name).toLowerCase()] || '' },
  socket: { remoteAddress: '127.0.0.1' },
})

let passed = 0
function check(name, condition) {
  assert.ok(condition, name)
  passed += 1
  console.log('PASS ' + name)
}

const home = resolveSeo('/', request('/'))
check('Homepage is indexable and has an absolute canonical', home.robots.startsWith('index,') && home.canonical === 'http://localhost:8045/')
check('Homepage provides structured organization data', home.jsonLd['@graph'].some(entry => entry['@type'] === 'Organization'))

for (const pathname of ['/workspace', '/team', '/settings', '/admin', '/orders']) {
  check(pathname + ' is marked noindex', resolveSeo(pathname, request(pathname)).robots === 'noindex,follow')
}

const share = resolveSeo('/share/deadbeef', request('/share/deadbeef'))
check('Unknown share tokens are noindex with a safe description', share.robots === 'noindex,follow' && !share.description.includes('deadbeef'))
check('Malformed share token escapes do not break metadata rendering', resolveSeo('/share/%', request('/share/%')).robots === 'noindex,follow')
check('Malformed collection token escapes do not break metadata rendering', resolveSeo('/collect/%', request('/collect/%')).robots === 'noindex,follow')
check('Unknown routes use the homepage canonical and noindex', resolveSeo('/missing/page', request('/missing/page')).canonical === home.canonical && resolveSeo('/missing/page', request('/missing/page')).robots === 'noindex,follow')

const robots = robotsTxt(request('/robots.txt'))
check('robots.txt publishes the sitemap and allows token pages to expose noindex', robots.includes('Sitemap: http://localhost:8045/sitemap.xml') && !robots.includes('Disallow: /share') && !robots.includes('Disallow: /collect'))
check('sitemap.xml contains absolute public URLs only', sitemapXml(request('/sitemap.xml')).includes('<loc>http://localhost:8045/</loc>'))

const html = renderSpaDocument(path.join(root, 'dist'), request('/workspace'))
check('Built SPA HTML receives route-specific SEO metadata', html.includes('<title>工作台 - 鲲穹文件传输</title>') && html.includes('name="robots" content="noindex,follow"'))

console.log(JSON.stringify({ passed, failures: 0 }))
