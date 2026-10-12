import assert from 'node:assert/strict'
import fs from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { OFFICE_PREVIEW_LIMITS as limits, assertOfficeFileSize, assertPreviewHtmlBudget, createOfficePreviewSession, inspectOfficeZip, readPreviewResponse, spreadsheetSheetHtml, spreadsheetSheetPage, validatePreviewWorkbook, verifyOfficeZip } from '../src/lib/office-preview.js'
import { parseOfficePreview } from '../src/workers/office-preview.js'

let passed = 0
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
function workbookBuffer(sheets) {
  const book = XLSX.utils.book_new()
  for (let index = 0; index < sheets.length; index++) XLSX.utils.book_append_sheet(book, sheets[index], `Sheet ${index + 1}`)
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true })
}
function zipCentralOffset(buffer, name) {
  const view = new DataView(buffer)
  for (let position = buffer.byteLength - 22; position >= 0; position--) if (view.getUint32(position, true) === 0x06054b50) {
    let offset = view.getUint32(position + 16, true)
    while (offset < position) {
      const size = view.getUint16(offset + 28, true)
      if (new TextDecoder().decode(new Uint8Array(buffer, offset + 46, size)) === name) return offset
      offset += 46 + size + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    }
  }
  throw new Error('fixture ZIP missing central directory')
}
const small = XLSX.utils.aoa_to_sheet([['Header', 'Value'], ['text <script> literal', 42]])

await check('The project safe DOCX and XLSX fixtures remain previewable', async () => {
  const data = new URL('../测试数据/鲲穹文件传输测试数据包/01-安全文件集/', import.meta.url)
  for (const [name, kind] of [['TC-03-08-Office文档预览.docx', 'document'], ['TC-03-09-Excel表格预览.xlsx', 'spreadsheet']]) {
    const bytes = fs.readFileSync(new URL(name, data))
    const result = await parseOfficePreview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), kind)
    assert.ok(result.html.length > 0)
  }
})

await check('A legal small spreadsheet preserves all cells and literal text', async () => {
  const result = await parseOfficePreview(workbookBuffer([small]), 'spreadsheet')
  assert.equal(result.sheets.length, 1)
  assert.equal(result.pages, 1)
  assert.equal((result.html.match(/<td\b/g) || []).length, 4)
  assert.ok(result.html.includes('Header') && result.html.includes('42') && result.html.includes('&lt;script&gt;'))
})

await check('Sparse declared ranges render only the current 100-row page', () => {
  const sheet = { A1: { t: 's', v: 'one cell' }, Z1000: { t: 's', v: 'last cell' }, '!ref': 'A1:Z1000' }
  const first = spreadsheetSheetPage(sheet), last = spreadsheetSheetPage(sheet, 9)
  assert.equal(first.pages, 10)
  assert.equal((first.html.match(/<td\b/g) || []).length, 2600)
  assert.ok(first.html.includes('one cell') && !first.html.includes('last cell'))
  assert.ok(last.html.includes('last cell'))
  assert.equal(spreadsheetSheetHtml(sheet), first.html)
  assert.throws(() => spreadsheetSheetPage(sheet, 10), /页码/)
})

await check('Hostile worksheet dimensions are rejected, including parse truncation metadata', async () => {
  for (const ref of ['A1:XFD1048576', 'A1:Z2001', 'A1:CW1', 'A1:Z2000', 'A0:B2', 'A3:A1']) assert.throws(() => spreadsheetSheetHtml({ A1: { t: 's', v: 'x' }, '!ref': ref }), /上限|无效/)
  assert.throws(() => spreadsheetSheetHtml({ '!ref': 'A1', '!fullref': 'A1:Z2001' }), /上限/)
  const zip = await JSZip.loadAsync(workbookBuffer([small]))
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  zip.file('xl/worksheets/sheet1.xml', xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:XFD1048576"/>'))
  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  await assert.rejects(() => parseOfficePreview(bytes, 'spreadsheet'), /上限/)
})

await check('Too many sheets, aggregate cells and oversized cell text are rejected', async () => {
  await assert.rejects(() => parseOfficePreview(workbookBuffer(Array.from({ length: limits.maxSheets + 1 }, () => small)), 'spreadsheet'), /工作表.*上限/)
  const book = XLSX.utils.book_new()
  for (let index = 0; index < 3; index++) XLSX.utils.book_append_sheet(book, { '!ref': 'A1:T2000' }, `Large ${index}`)
  assert.throws(() => validatePreviewWorkbook(book), /总数.*上限/)
  assert.throws(() => spreadsheetSheetHtml({ A1: { t: 's', v: 'x'.repeat(limits.maxCellText + 1) }, '!ref': 'A1' }), /文本.*上限/)
})

await check('Valid compressed archives pass declared and actual expansion validation', async () => {
  const buffer = workbookBuffer([small])
  const result = inspectOfficeZip(buffer, 'spreadsheet')
  assert.ok(result.entries.length > 0 && result.expandedBytes > 0)
  await verifyOfficeZip(buffer, 'spreadsheet')
})

await check('ZIP bombs and forged uncompressed sizes stop before conversion', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', 'A'.repeat(128 * 1024))
  const bomb = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  assert.throws(() => inspectOfficeZip(bomb, 'document'), /解压大小.*上限/)
  const forged = bomb.slice(0)
  new DataView(forged).setUint32(zipCentralOffset(forged, 'word/document.xml') + 24, 16, true)
  assert.doesNotThrow(() => inspectOfficeZip(forged, 'document'))
  await assert.rejects(() => verifyOfficeZip(forged, 'document'), /实际解压大小/)
  const excessive = new JSZip()
  for (let index = 0; index <= limits.maxEntries; index++) excessive.file(`part-${index}.xml`, 'x')
  const excessiveBuffer = await excessive.generateAsync({ type: 'arraybuffer' })
  assert.throws(() => inspectOfficeZip(excessiveBuffer), /数量/)
})

await check('Stream reading enforces actual bytes and cancels over-limit bodies', async () => {
  let canceled = false
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)) }, cancel() { canceled = true } }))
  await assert.rejects(() => readPreviewResponse(response, { maxBytes: 12 }), /上限/)
  assert.equal(canceled, true)
  assert.equal((await readPreviewResponse(new Response(new Uint8Array([1, 2, 3])), { maxBytes: 3 })).byteLength, 3)
  await assert.rejects(() => readPreviewResponse(new Response('x', { headers: { 'content-length': '4000' } }), { maxBytes: 12 }), /上限/)
  assert.throws(() => assertOfficeFileSize(limits.maxFileBytes + 1), /上限/)
  assert.throws(() => assertOfficeFileSize(limits.presentationFileBytes + 1, 'presentation'), /上限/)
})

await check('Closing a preview aborts a pending stream and terminates parser RPCs', async () => {
  const controller = new AbortController()
  let streamCanceled = false
  const response = new Response(new ReadableStream({ cancel() { streamCanceled = true } }))
  const reading = readPreviewResponse(response, { signal: controller.signal })
  controller.abort()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.equal(streamCanceled, true)
  const workerController = new AbortController()
  let terminated = false
  const session = createOfficePreviewSession({ signal: workerController.signal, workerFactory: () => ({ postMessage() {}, terminate() { terminated = true } }) })
  const parsing = session.request('parse', {})
  workerController.abort()
  await assert.rejects(parsing, { name: 'AbortError' })
  assert.equal(terminated, true)
})

await check('Parser deadline actually terminates a nonresponding worker', async () => {
  const originalTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, delay) => originalTimeout(callback, delay === limits.timeoutMs ? 5 : delay)
  let terminated = false
  try {
    const session = createOfficePreviewSession({ workerFactory: () => ({ postMessage() {}, terminate() { terminated = true } }) })
    await assert.rejects(() => session.request('parse', {}), /解析超时/)
    assert.equal(terminated, true)
  } finally { globalThis.setTimeout = originalTimeout }
})

await check('Short HTML with excessive DOM nodes is rejected before sanitization', () => {
  assert.doesNotThrow(() => assertPreviewHtmlBudget('<p>正文</p><table><tr><td>1</td></tr></table>'))
  assert.throws(() => assertPreviewHtmlBudget('<br>'.repeat(limits.maxHtmlElements + 1)), /元素.*上限/)
  assert.throws(() => assertPreviewHtmlBudget('x'.repeat(limits.maxHtmlBytes + 1)), /正文.*上限/)
  assert.throws(() => assertPreviewHtmlBudget('<div>'.repeat(limits.maxHtmlDepth + 1) + 'text' + '</div>'.repeat(limits.maxHtmlDepth + 1)), /嵌套层级.*上限/)
})

await check('PPTX receives stricter slide, XML complexity and embedded image limits', async () => {
  const slides = new JSZip()
  for (let index = 1; index <= limits.maxSlides + 1; index++) slides.file(`ppt/slides/slide${index}.xml`, '<p:sld/>')
  const slidesBuffer = await slides.generateAsync({ type: 'arraybuffer' })
  assert.throws(() => inspectOfficeZip(slidesBuffer, 'presentation'), /页.*上限/)
  const xml = new JSZip()
  xml.file('ppt/slides/slide1.xml', '<!DOCTYPE x [<!ENTITY a "b">]><p:sld/>')
  const xmlBuffer = await xml.generateAsync({ type: 'arraybuffer' })
  await assert.rejects(() => verifyOfficeZip(xmlBuffer, 'presentation'), /复杂度/)
  const image = new JSZip(), png = new Uint8Array(24), view = new DataView(png.buffer)
  view.setUint32(0, 0x89504e47); view.setUint32(16, 100000); view.setUint32(20, 100000)
  image.file('word/media/image1.png', png)
  const imageBuffer = await image.generateAsync({ type: 'arraybuffer' })
  await assert.rejects(() => verifyOfficeZip(imageBuffer), /图片尺寸/)
})

console.log(`Office boundary verification passed (${passed} behavior groups).`)
