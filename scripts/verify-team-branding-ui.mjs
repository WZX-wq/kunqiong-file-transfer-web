// 实际 React 页面与事件，仅替换 HTTP 数据。无真实账号、图片或数据库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(x => x.type === 'chunk').code
let passed = 0
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
async function waitFor(fn, label) { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(10) } assert.fail(label) }
async function mount(route = '/team?tab=branding', role = 'owner', branded = false) {
  const errors = [], calls = [], virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => { if (!/navigation/.test(error.message)) errors.push(error.message) })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local' + route, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
  const { window } = dom, document = window.document
  // JSDOM 尚未提供 Blob.arrayBuffer，使用它原生的 FileReader 补齐标准 API。
  const NativeFileReader = window.FileReader
  window.Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => { const reader = new NativeFileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this) }) }
  const plan = { id: 'enterprise', label: '企业版', team: true, teamSpaceBytes: 1024 ** 4, totalBytes: 1024 ** 4, permanent: true, features: [] }
  const members = [{ id: 'm-owner', userId: 'owner', role: 'owner', status: 'active', displayName: '所有者', usedBytes: 0 }, { id: 'm-admin', userId: 'admin', role: 'admin', status: 'active', displayName: '管理员', usedBytes: 0 }, { id: 'm-member', userId: 'member', role: 'member', status: 'active', displayName: '成员', usedBytes: 0 }]
  let config = { enabled: branded, name: branded ? '已保存品牌' : '验收团队', introduction: branded ? '已保存简介' : '', logoUrl: branded ? '/logo.webp' : '', revision: branded ? 1 : 0 }, nextFailure = null, held = false, release
  const branding = () => config.enabled ? { name: config.name, introduction: config.introduction, logoUrl: config.logoUrl } : null
  const organization = () => ({ id: 'org', slug: 'team', name: '验收团队', ownerUserId: 'owner', members, ownershipHandoverHistory: [], ...(['owner', 'admin'].includes(role) ? { branding: config } : {}) })
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push({ url, method, body: options.body }); let data = {}, status = 200
    if (url === '/api/auth/me') data = { user: role ? { id: role, nickname: role, plan } : null }
    else if (url === '/api/account/team/overview') data = { organization: organization(), canManage: ['owner', 'admin'].includes(role), isOwner: role === 'owner', plan, capacity: { usedBytes: 0, totalBytes: 1024 ** 4 }, memberUsage: members, resources: [], joinRequests: [] }
    else if (url === '/api/account/workspace/branding') {
      if (method === 'PATCH' || method === 'DELETE') {
        if (held) await new Promise(resolve => { release = resolve })
        if (nextFailure) { status = nextFailure.status; data = { message: nextFailure.message }; nextFailure = null }
        else {
          const body = JSON.parse(options.body)
          config = method === 'DELETE' ? { enabled: false, name: '验收团队', introduction: '', logoUrl: '', revision: config.revision + 1 } : { ...config, enabled: true, name: body.name, introduction: body.introduction, revision: config.revision + 1, ...(Object.hasOwn(body, 'logo') ? { logoUrl: body.logo ? '/new-logo.webp' : '' } : {}) }
          data = { branding: config }
        }
      } else data = { branding: config }
    } else if (String(url).startsWith('/api/shares/token/')) data = { share: { id: 'share', code: 'SHARE1', status: 'active', files: [{ name: '资料.pdf', relativePath: '资料.pdf', size: 12, mimeType: 'application/pdf' }], branding: branding(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() } }
    else if (String(url).startsWith('/api/collections/task')) data = { collection: { id: 'task', token: 'task', title: '收集材料', description: '请上传', branding: branding(), deadline: new Date(Date.now() + 86400000).toISOString(), materials: [], customFields: [], allowedTypes: ['全部格式'], maxFileSizeMb: 10, status: 'active' } }
    else if (url === '/api/runtime-config') data = { upload: { singleFileLimitBytes: 1024 ** 3 } }
    else if (url === '/api/account/messages') data = { messages: [] }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  await waitFor(() => document.querySelector('.public-shell'), 'page mounts'); await delay(70)
  const buttons = () => [...document.querySelectorAll('button')]
  const find = label => buttons().find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
  const click = async label => { const button = find(label); assert.ok(button, 'button ' + label); button.click(); await delay(25) }
  const input = async (selector, value) => { const node = document.querySelector(selector); assert.ok(node, selector); const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); await delay(20) }
  const choose = async file => { const picker = document.querySelector('input[type=file]'); Object.defineProperty(picker, 'files', { configurable: true, value: [file] }); picker.dispatchEvent(new window.Event('change', { bubbles: true })); await delay(45) }
  return { dom, window, document, calls, errors, find, click, input, choose, fail: (status, message) => { nextFailure = { status, message } }, hold: () => { held = true }, release: () => { held = false; release?.() }, setRemote: () => { config = { ...config, revision: 4, name: '其他管理员更新' } } }
}
for (const role of ['owner', 'admin']) {
  const f = await mount('/team?tab=branding', role)
  try {
    await waitFor(() => f.document.querySelector('#team-brand-name'), 'brand editor mounts')
    check(role + '有品牌入口和编辑器', !!f.find('团队品牌') && !!f.document.querySelector('#team-brand-introduction'))
    check('品牌页省去重复用量卡', !f.document.querySelector('.team-kpi-grid'))
    check('恢复默认初始不可用', f.find('恢复默认').disabled)
    const xss = '<img src=x onerror=alert(1)>测试中心'
    await f.input('#team-brand-name', xss); await f.input('#team-brand-introduction', '请提交入学材料')
    check('预览只渲染文本不会插入HTML', f.document.querySelector('.team-branding-preview .team-brand-copy strong').textContent === xss && !f.document.querySelector('.team-branding-preview img'))
    check('名称简介有长度限制', f.document.querySelector('#team-brand-name').maxLength === 80 && f.document.querySelector('textarea').maxLength === 160)
    await f.click('收集页')
    check('切换预览保留草稿', f.document.querySelector('.team-branding-preview-content h3').textContent === '请提交你的材料' && f.document.querySelector('#team-brand-name').value === xss)
    await f.click('保存并启用')
    await waitFor(() => f.document.querySelector('.team-branding-status').textContent === '已启用', 'saved status')
    check('提交所填名称和版本', f.calls.some(c => c.method === 'PATCH' && JSON.parse(c.body).name === xss && JSON.parse(c.body).revision === 0))
    check('无修改时不可重复保存', f.find('保存并启用').disabled)
    await f.click('恢复默认'); check('恢复默认有二次确认', !!f.document.querySelector('.confirm-modal'))
    await f.click('取消'); check('取消不发送删除', !f.calls.some(c => c.method === 'DELETE'))
    await f.click('恢复默认'); f.document.querySelector('.confirm-modal .primary-button').click()
    await waitFor(() => f.document.querySelector('.team-branding-status').textContent === '平台默认', 'reset status')
    check('重置使用最新版本且恢复团队名', f.calls.some(c => c.method === 'DELETE' && JSON.parse(c.body).revision === 1) && f.document.querySelector('#team-brand-name').value === '验收团队')
    check(role + '无运行错误', f.errors.length === 0)
  } finally { f.dom.window.close() }
}
const f = await mount('/team?tab=branding', 'owner', true)
try {
  await waitFor(() => f.document.querySelector('#team-brand-name'), 'saved editor')
  const badType = new f.window.File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })
  await f.choose(badType)
  check('客户端阻止SVG且不发送请求', f.document.body.textContent.includes('请选择静态') && !f.calls.some(c => c.method === 'PATCH'))
  await f.choose(new f.window.File([new Uint8Array(400 * 1024 + 1)], 'large.png', { type: 'image/png' }))
  check('客户端阻止超限Logo', f.document.body.textContent.includes('400 KB'))
  await f.choose(new f.window.File(['fixture'], 'logo.png', { type: 'image/png' }))
  await waitFor(() => f.document.querySelector('.team-branding-preview img')?.src.startsWith('data:image/png;base64,'), 'Logo data URL preview: ' + f.document.querySelector('.team-branding-form').textContent + ' errors=' + f.errors.join(','))
  check('选择Logo立即预览', f.document.querySelector('.team-branding-preview img')?.src.startsWith('data:image/png;base64,'))
  f.fail(400, 'Logo 图片损坏，请重新选择有效图片')
  await f.click('保存并启用')
  check('服务器校验失败保留草稿和原状态', f.document.body.textContent.includes('Logo 图片损坏') && f.document.querySelector('#team-brand-name').value === '已保存品牌' && !f.find('保存并启用').disabled)
  f.fail(404, '接口不存在')
  await f.click('保存并启用')
  check('旧后端缺少接口时明确提示更新并保留草稿', f.document.body.textContent.includes('团队品牌服务尚未更新') && f.document.body.textContent.includes('当前填写内容已保留') && f.document.querySelector('#team-brand-name').value === '已保存品牌' && f.document.querySelector('.team-branding-preview img')?.src.startsWith('data:image/png;base64,') && !f.find('保存并启用').disabled)
  await f.click('移除 Logo'); await f.click('保存并启用')
  check('移除Logo发送显式空值', JSON.parse(f.calls.filter(c => c.method === 'PATCH').at(-1).body).logo === '')
  await f.input('#team-brand-name', '冲突草稿'); f.fail(409, '品牌已修改')
  await f.click('保存并启用')
  check('冲突保留草稿并要求重新加载', f.document.querySelector('#team-brand-name').value === '冲突草稿' && f.find('保存并启用').disabled && !!f.find('重新加载'))
  f.setRemote(); await f.click('重新加载'); await f.click('保留修改')
  check('取消重新加载保留草稿', f.document.querySelector('#team-brand-name').value === '冲突草稿')
  await f.click('重新加载'); f.document.querySelector('.confirm-modal .primary-button').click()
  await waitFor(() => f.document.querySelector('#team-brand-name').value === '其他管理员更新', 'reload new config')
  await f.input('#team-brand-name', '提交中草稿'); f.hold(); await f.click('保存并启用')
  const saveCount = f.calls.filter(c => c.method === 'PATCH').length
  f.document.querySelector('.team-branding-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }))
  await delay(25)
  check('提交中按钮禁用并防止重复请求', f.calls.filter(c => c.method === 'PATCH').length === saveCount && f.document.querySelector('.team-branding-actions button').disabled)
  f.release(); await waitFor(() => f.document.querySelector('.team-branding-status').textContent === '已启用', 'held save completes')
  check('上传及冲突操作无运行错误', f.errors.length === 0)
} finally { f.dom.window.close() }
for (const role of ['member', null]) {
  const f = await mount('/team?tab=branding', role)
  try { check((role || '游客') + '不能从URL进入品牌编辑', !f.document.querySelector('.team-branding-panel') && !f.find('团队品牌')) } finally { f.dom.window.close() }
}
for (const route of ['/share/share', '/e/team/collect/task']) {
  for (const enabled of [true, false]) {
    const f = await mount(route, null, enabled)
    try {
      await waitFor(() => f.document.querySelector(route.includes('collect') ? '.collection-submit-hero' : '.share-hero'), 'public content loads')
      check(route + (enabled ? '展示团队品牌' : '未配置回到默认'), enabled ? f.document.querySelector('.team-brand-copy strong')?.textContent === '已保存品牌' : !f.document.querySelector('.team-brand'))
      if (enabled) { const image = f.document.querySelector('.team-brand img'); image.dispatchEvent(new f.window.Event('error')); await delay(20); check('Logo加载失败有默认图标', !!f.document.querySelector('.team-brand-logo svg') && !f.document.querySelector('.team-brand img')) }
      check(route + '没有运行错误', f.errors.length === 0)
    } finally { f.dom.window.close() }
  }
}
const report = { executedAt: new Date().toISOString(), passed, environment: 'Real React routes in JSDOM; synthetic HTTP fixtures' }
fs.mkdirSync(path.join(root, '.workbuddy/team-branding'), { recursive: true })
fs.writeFileSync(path.join(root, '.workbuddy/team-branding/ui-results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
