import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { manualVersion, sections, screenshots } from '../docs/user-manual-content.mjs'

const root = path.resolve(import.meta.dirname, '..')
const target = path.join(root, 'public/user-manual.html')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const before = fs.readFileSync(target)
execFileSync(process.execPath, [path.join(root, '_build_manual.mjs')], { cwd: root, stdio: 'pipe' })
const html = fs.readFileSync(target)
assert.equal(sha256(html), sha256(before), 'The checked-in manual is stale or generation is not deterministic')
const { window } = new JSDOM(html.toString())
const document = window.document
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manual_shots/current/manifest.json'), 'utf8'))
const captures = new Map(JSON.parse(fs.readFileSync(path.join(root, 'manual_shots/current/captures.json'), 'utf8')).map(entry => [entry.name, entry]))
assert.equal(document.documentElement.lang, 'zh-CN')
assert.equal(document.querySelector('meta[name="manual-version"]')?.content, manualVersion)
assert.equal(manifest.version, manualVersion)
assert.equal(document.querySelectorAll('main section').length, sections.length)
assert.equal(document.querySelectorAll('figure[data-shot]').length, screenshots.size)
assert.equal(new Set([...document.querySelectorAll('[id]')].map(node => node.id)).size, document.querySelectorAll('[id]').length, 'Duplicate HTML IDs')
for (const link of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(link.hash.slice(1)), `Broken anchor ${link.hash}`)
for (const section of sections) {
  assert.ok(document.getElementById(section.id)?.querySelector('h2')?.textContent.includes(section.title), `Missing section ${section.id}`)
}
const figures = [...document.querySelectorAll('figure[data-shot]')]
assert.equal(new Set(figures.map(node => node.dataset.shot)).size, figures.length, 'Duplicate screenshot names')
for (const entry of manifest.screenshots) {
  const figure = figures.find(node => node.dataset.shot === entry.name)
  assert.ok(figure, `Missing screenshot ${entry.name}`)
  const image = figure.querySelector('img')
  const definition = screenshots.get(entry.name)
  const capture = captures.get(entry.name)
  const match = image.src.match(/^data:image\/png;base64,(.+)$/)
  assert.ok(match, `Non-embedded or broken screenshot ${entry.name}`)
  const bytes = Buffer.from(match[1], 'base64')
  assert.equal(sha256(bytes), entry.sha256, `Wrong embedded screenshot ${entry.name}`)
  assert.equal(sha256(fs.readFileSync(path.join(root, 'manual_shots/current', entry.file))), entry.sha256)
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, entry.width)
  assert.equal(metadata.height, entry.height)
  assert.equal(Number(image.getAttribute('width')), entry.width)
  assert.equal(Number(image.getAttribute('height')), entry.height)
  assert.equal(image.alt, definition.caption)
  assert.ok(figure.querySelector('figcaption')?.textContent.includes(definition.caption))
  assert.deepEqual(entry.labels, definition.labels)
  assert.equal(entry.url, capture.url)
  for (const label of definition.labels) assert.ok(capture.snapshot.includes(label), `Screenshot ${entry.name} does not show ${label}`)
}
const logo = fs.readFileSync(path.join(root, 'public/app-icon.png'))
for (const node of [document.querySelector('link[rel="icon"]'), document.querySelector('.brand img')]) {
  const value = node.getAttribute(node.tagName === 'LINK' ? 'href' : 'src')
  assert.equal(sha256(Buffer.from(value.split(',')[1], 'base64')), sha256(logo), 'Manual must use the current software icon')
}
const text = document.body.textContent
for (const obsolete of ['2026-10-13', '收集给我的', '恢复登录头像', '会员版及以上权益', '5 MB/片', '登录后 ≤ 5 GB', '未登录 ≤ 500 MB', '#168b73']) {
  assert.ok(!html.toString().includes(obsolete), `Obsolete manual content: ${obsolete}`)
}
for (const current of ['查看已收文件', '复制管理链接', '复制回执', '账号与安全', '文件清理', '月卡会员', '团队季卡', '半年卡', '年卡', '不包含永久保存']) assert.ok(text.includes(current), `Missing current instructions: ${current}`)
assert.ok(!document.querySelector('manual-shot'), 'Unrendered screenshot placeholders')
assert.ok(html.toString().includes('prefers-reduced-motion'))
assert.ok(html.toString().includes('@media print'))
if (process.argv.includes('--dist')) assert.equal(sha256(fs.readFileSync(path.join(root, 'dist/user-manual.html'))), sha256(html), 'Built manual differs from current source')
const url = process.argv.find(argument => argument.startsWith('--url='))?.slice(6)
if (url) {
  const response = await fetch(url)
  assert.equal(response.status, 200, 'Served manual is unavailable')
  assert.match(response.headers.get('content-type') || '', /text\/html/)
  assert.equal(sha256(Buffer.from(await response.arrayBuffer())), sha256(html), 'HTTP serves an obsolete manual')
}
window.close()
console.log(`PASS: ${sections.length} sections, ${figures.length} named screenshot/text pairs, source hashes, icon, anchors and deterministic generation${process.argv.includes('--dist') ? ', dist' : ''}${url ? ', HTTP' : ''}`)
console.log(`SHA256 ${sha256(html)}`)
