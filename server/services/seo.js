// 站点级 SEO：按路由生成 <head>，替换 dist/index.html 里的 <!--seo:start-->…<!--seo:end-->
//
// 为什么必须在服务端做：本项目是纯客户端渲染的 SPA，服务端只回一份空的 <div id="root">。
// 搜索引擎（尤其是百度/搜狗/360）与所有社交平台抓取器（微信、Telegram、Twitter 等）
// 都不会执行 JS，唯一能读到的就是这份 HTML 的 <head>。不在服务端按 URL 注入，
// 每个链接的标题、摘要、分享卡片图都只能是站点默认值 —— 这是自然流量最大的漏点。
//
// 依赖方向：services 只依赖 config / state / lib / 其它 services，不 import routes、不 import server.mjs。

import fs from 'node:fs'
import path from 'node:path'
import { requestOrigin } from '../lib/request-security.js'
import { metadata } from '../lib/metadata-store.js'
import { currentCollectionStatus, currentShareStatus } from './account.js'

export const SITE_NAME = '鲲穹文件传输'
const SITE_TAGLINE = '免登录大文件传输与文件收集平台'
const SEO_START = '<!--seo:start-->'
const SEO_END = '<!--seo:end-->'

const DEFAULT_TITLE = `${SITE_NAME} - ${SITE_TAGLINE}`
// 155 字符以内，前 78 字符在移动端结果页就可见，所以卖点前置。
const DEFAULT_DESCRIPTION = '鲲穹文件传输支持免登录发送大文件，文件额度按当前套餐配置，可生成取件码、链接与二维码；也能创建匿名文件收集任务，多人提交后一键打包下载。上传即用，到期自动清理。'
const DEFAULT_KEYWORDS = '文件传输,大文件传输,免登录传文件,文件分享,取件码,文件收集,临时文件分享,团队文件空间'
const OG_IMAGE_PATH = '/og-cover.png'

// 这些路径下的页面是「工具界面 / 私有数据」，进索引只会制造薄内容与重复内容。
// 注意：分享页与收集页**不写进 robots.txt 的 Disallow**，否则爬虫读不到这里的 noindex 反而可能被索引。
const PRIVATE_ROUTES = [
  { prefix: '/workspace', title: `工作台 - ${SITE_NAME}` },
  { prefix: '/team', title: `团队空间 - ${SITE_NAME}` },
  { prefix: '/settings', title: `账号设置 - ${SITE_NAME}` },
  { prefix: '/admin', title: `管理后台 - ${SITE_NAME}` },
  { prefix: '/orders', title: `我的订单 - ${SITE_NAME}` },
]

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function clampText(value = '', max = 60) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

function formatDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizePath(pathname = '/') {
  const raw = String(pathname || '/').split('?')[0].split('#')[0]
  if (raw.length > 1) {
    const trimmed = raw.replace(/\/+$/, '')
    return trimmed || '/'
  }
  return raw || '/'
}

function decodePathSegment(value) {
  try { return decodeURIComponent(value) }
  catch { return value }
}

function shareSeo(token) {
  const share = (metadata.shares || []).find((item) => item.id === token)
  if (!share) return { title: `分享不存在或已失效 - ${SITE_NAME}`, description: '该分享链接不存在或已被删除，请向发送人重新索取链接。' }
  const status = currentShareStatus(share)
  if (status !== 'active') {
    return {
      title: `这个文件分享已${status === 'closed' ? '关闭' : '过期'} - ${SITE_NAME}`,
      description: '该分享链接已失效，文件已被清理。可以请发送人重新发起一次传输。',
    }
  }
  const files = Array.isArray(share.files) ? share.files : []
  const totalBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  // 提取密码保护时不能把文件名写进 <head> —— 那等于把页面内容提前泄露给未验证的人。
  if (share.passwordHash) {
    return {
      title: `受密码保护的文件分享 - ${SITE_NAME}`,
      description: '该分享已开启提取密码，验证密码后即可查看并下载文件。文件由鲲穹文件传输临时托管，到期自动清理。',
    }
  }
  const firstName = files[0]?.name ? clampText(files[0].name, 26) : ''
  const title = firstName
    ? `${firstName}${files.length > 1 ? ` 等 ${files.length} 个文件` : ''} - ${SITE_NAME}`
    : `文件分享 - ${SITE_NAME}`
  const expiry = formatDay(share.expiresAt)
  const description = `共 ${files.length} 个文件${totalBytes ? `，合计 ${formatFileSize(totalBytes)}` : ''}，点击链接即可下载${expiry ? `，有效期至 ${expiry}` : ''}。由鲲穹文件传输临时托管，到期自动清理。`
  return { title, description }
}

function collectionSeo(token) {
  const task = (metadata.collections || []).find((item) => item.token === token)
  if (!task) return { title: `收集任务不存在 - ${SITE_NAME}`, description: '该文件收集链接不存在或已被删除，请向发起人重新索取链接。' }
  const status = currentCollectionStatus(task)
  if (status !== 'active') {
    return {
      title: `这个文件收集已${status === 'closed' ? '关闭' : '截止'} - ${SITE_NAME}`,
      description: '该文件收集任务已结束，无法继续提交文件。可以联系发起人确认是否重新开放。',
    }
  }
  const title = task.title ? `${clampText(task.title, 28)} - 文件收集 - ${SITE_NAME}` : `文件收集 - ${SITE_NAME}`
  const deadline = formatDay(task.deadline)
  const description = task.description
    ? clampText(task.description, 110)
    : `邀请你提交文件的在线收集任务${deadline ? `，截止 ${deadline}` : ''}。无需注册即可上传，发起人可一次性打包下载全部提交。`
  return { title, description }
}

function siteJsonLd(origin) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: { '@type': 'ImageObject', url: `${origin}/brand-logo.png` },
        description: '鲲穹文件传输是面向个人与团队的在线文件传输服务，支持免登录大文件分享与匿名文件收集。',
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: SITE_NAME,
        alternateName: '鲲穹传文件',
        inLanguage: 'zh-CN',
        publisher: { '@id': `${origin}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${origin}/#application`,
        name: SITE_NAME,
        url: `${origin}/`,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Web',
        inLanguage: 'zh-CN',
        description: DEFAULT_DESCRIPTION,
        // 只写真实的免费额度，不编造评分（虚假 aggregateRating 会触发结构化数据人工处罚）。
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY', description: '免费使用，无需注册即可发送文件' },
        featureList: ['免登录大文件传输', '取件码 / 链接 / 二维码取件', '匿名文件收集', '团队空间与企业后台', '到期自动清理'],
      },
    ],
  }
}

function buildHead(seo) {
  const title = escapeHtml(seo.title || DEFAULT_TITLE)
  const description = escapeHtml(seo.description || DEFAULT_DESCRIPTION)
  const canonical = escapeHtml(seo.canonical || '/')
  const image = escapeHtml(seo.image || OG_IMAGE_PATH)
  const titleText = seo.title || DEFAULT_TITLE
  const descriptionText = seo.description || DEFAULT_DESCRIPTION
  const lines = [
    '<title>' + title + '</title>',
    '<meta name="description" content="' + description + '" />',
  ]
  if (seo.keywords) lines.push('<meta name="keywords" content="' + escapeHtml(seo.keywords) + '" />')
  lines.push('<meta name="robots" content="' + escapeHtml(seo.robots || 'index,follow') + '" />')
  lines.push('<meta name="applicable-device" content="pc,mobile" />')
  lines.push('<link rel="canonical" href="' + canonical + '" />')
  lines.push('<meta property="og:type" content="' + escapeHtml(seo.ogType || 'website') + '" />')
  lines.push('<meta property="og:site_name" content="' + escapeHtml(SITE_NAME) + '" />')
  lines.push('<meta property="og:locale" content="zh_CN" />')
  lines.push('<meta property="og:title" content="' + escapeHtml(clampText(titleText, 70)) + '" />')
  lines.push('<meta property="og:description" content="' + escapeHtml(clampText(descriptionText, 120)) + '" />')
  lines.push('<meta property="og:url" content="' + canonical + '" />')
  lines.push('<meta property="og:image" content="' + image + '" />')
  lines.push('<meta property="og:image:width" content="1200" />')
  lines.push('<meta property="og:image:height" content="630" />')
  lines.push('<meta property="og:image:alt" content="' + escapeHtml(SITE_NAME) + '" />')
  lines.push('<meta name="twitter:card" content="summary_large_image" />')
  lines.push('<meta name="twitter:title" content="' + escapeHtml(clampText(titleText, 70)) + '" />')
  lines.push('<meta name="twitter:description" content="' + escapeHtml(clampText(descriptionText, 120)) + '" />')
  lines.push('<meta name="twitter:image" content="' + image + '" />')
  if (seo.jsonLd) {
    // </script> 出现在 JSON 里会提前闭合标签，必须转义。
    const payload = JSON.stringify(seo.jsonLd).replace(/<\//g, '<\\/')
    lines.push('<script type="application/ld+json">' + payload + '</script>')
  }
  return lines.join('\n    ')
}

/**
 * 解析某个 URL 路径应当输出的 head 信息。
 * 纯函数式：只读 metadata 快照，不写状态，可以安全地在每个 HTML 请求里调用。
 */
export function resolveSeo(pathname = '/', req) {
  const origin = requestOrigin(req)
  const route = normalizePath(pathname)
  const canonical = `${origin}${route === '/' ? '/' : route}`
  const base = {
    canonical,
    image: `${origin}${OG_IMAGE_PATH}`,
    robots: 'index,follow,max-image-preview:large',
    ogType: 'website',
  }

  if (route === '/') {
    return { ...base, title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, keywords: DEFAULT_KEYWORDS, jsonLd: siteJsonLd(origin) }
  }

  const share = /^\/share\/([^/]+)$/.exec(route) || /^\/e\/[^/]+\/share\/([^/]+)$/.exec(route)
  if (share) {
    return { ...base, ...shareSeo(decodePathSegment(share[1])), robots: 'noindex,follow', ogType: 'article' }
  }

  const collection = /^\/collect\/([^/]+)$/.exec(route) || /^\/e\/[^/]+\/collect\/([^/]+)$/.exec(route)
  if (collection) {
    return { ...base, ...collectionSeo(decodePathSegment(collection[1])), robots: 'noindex,follow', ogType: 'article' }
  }

  if (/^\/share\/manage\//.test(route)) {
    return { ...base, title: `分享管理 - ${SITE_NAME}`, description: '管理你的文件分享：修改有效期、下载次数与提取密码。', robots: 'noindex,follow' }
  }
  if (/^\/collect\/manage\//.test(route)) {
    return { ...base, title: `收集任务管理 - ${SITE_NAME}`, description: '管理文件收集任务，查看并打包下载全部提交。', robots: 'noindex,follow' }
  }
  if (/^\/e\/[^/]+$/.test(route)) {
    return { ...base, title: `团队空间邀请 - ${SITE_NAME}`, description: '你收到一个鲲穹团队空间邀请，登录后即可申请加入。', robots: 'noindex,follow' }
  }

  const matched = PRIVATE_ROUTES.find((item) => route === item.prefix || route.startsWith(`${item.prefix}/`))
  if (matched) {
    return { ...base, title: matched.title, description: `${SITE_NAME}的${matched.title.split(' - ')[0]}页面。`, robots: 'noindex,follow' }
  }

  // 未知路径：SPA 会兜底渲染首页，若不处理就是「同一份内容对应无数个 URL」的重复内容。
  return { ...base, canonical: `${origin}/`, title: `页面不存在 - ${SITE_NAME}`, description: '你访问的页面不存在，可以回到首页继续使用文件传输与文件收集。', robots: 'noindex,follow' }
}

const templateCache = new Map()

function readTemplate(distRoot) {
  const file = path.join(distRoot, 'index.html')
  try {
    const stat = fs.statSync(file)
    const cached = templateCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.html
    const html = fs.readFileSync(file, 'utf8')
    templateCache.set(file, { mtimeMs: stat.mtimeMs, html })
    return html
  } catch {
    return null
  }
}

/**
 * 生成该请求对应的完整 HTML 文档。返回 null 表示无法注入（缺少 dist/index.html 或标记被改动），
 * 调用方应退回原样 sendFile —— SEO 失效但页面不会白屏。
 */
export function renderSpaDocument(distRoot, req) {
  const template = readTemplate(distRoot)
  if (!template) return null
  const start = template.indexOf(SEO_START)
  const end = template.indexOf(SEO_END)
  if (start === -1 || end === -1 || end < start) return null
  const seo = resolveSeo(req.path, req)
  return `${template.slice(0, start)}${buildHead(seo)}${template.slice(end + SEO_END.length)}`
}

export function robotsTxt(req) {
  const origin = requestOrigin(req)
  // 私有区用 Disallow；分享页/收集页故意放开，让爬虫读到页面里的 noindex。
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /workspace',
    'Disallow: /settings',
    'Disallow: /team',
    'Disallow: /orders',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

export function sitemapXml(req) {
  const origin = requestOrigin(req)
  const today = new Date().toISOString().slice(0, 10)
  const entries = [
    { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${origin}/user-manual.html`, changefreq: 'monthly', priority: '0.6' },
  ]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => `  <url><loc>${entry.loc}</loc><lastmod>${today}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`),
    '</urlset>',
    '',
  ].join('\n')
}
