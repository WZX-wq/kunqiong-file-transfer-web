// 验证 Office 内嵌图片格式放宽：EMF 跳过、BMP/WEBP/ICO 量尺寸、超大图仍拦截
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { verifyOfficeZip } from './src/lib/office-preview-core.js'

let passed = 0
const check = async (label, fn) => { await fn(); passed += 1; console.log('PASS ' + label) }

// 用 SheetJS 生成一个普通 xlsx，再往里塞任意 media 文件
const makeXlsxWithMedia = async (mediaName, mediaBytes) => {
  const base = XLSX.write({ SheetNames: ['S1'], Sheets: { S1: XLSX.utils.aoa_to_sheet([['姓名', '部门'], ['张三', '设计']]) } }, { type: 'buffer', bookType: 'xlsx' })
  const zip = await JSZip.loadAsync(base)
  zip.file(mediaName, mediaBytes)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const emf = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const bmp = (() => {
  // 2x2 24bit BMP
  const b = Buffer.alloc(54 + 16, 0)
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14); b.writeInt32LE(2, 18); b.writeInt32LE(2, 22)
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(b.length - 54, 34)
  return new Uint8Array(b)
})()
const hugeBmp = (() => {
  const b = Buffer.alloc(54, 0)
  b.write('BM', 0); b.writeUInt32LE(54, 2); b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14); b.writeInt32LE(20000, 18); b.writeInt32LE(20000, 22)
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28)
  return new Uint8Array(b)
})()
const webp = (() => {
  // VP8X 容器：canvas 320x240（存的是 -1）
  const b = Buffer.alloc(40, 0)
  b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write('VP8X', 12)
  b.writeUInt32LE(10, 16)
  b.writeUIntLE(320 - 1, 24, 3); b.writeUIntLE(240 - 1, 27, 3)
  return new Uint8Array(b)
})()

await check('xlsx 内嵌 EMF：不再整份失败（跳过该图）', async () => {
  const buffer = await makeXlsxWithMedia('xl/media/image1.emf', emf)
  const archive = await verifyOfficeZip(buffer, 'spreadsheet')
  assert.ok(archive && archive.entries.length > 2)
})

await check('xlsx 内嵌 BMP：正确量尺寸并通过', async () => {
  const buffer = await makeXlsxWithMedia('xl/media/image1.bmp', bmp)
  await verifyOfficeZip(buffer, 'spreadsheet')
})

await check('xlsx 内嵌超大 BMP：仍在上限处拦截', async () => {
  const buffer = await makeXlsxWithMedia('xl/media/image1.bmp', hugeBmp)
  await assert.rejects(() => verifyOfficeZip(buffer, 'spreadsheet'), /图片尺寸超过预览上限/)
})

await check('xlsx 内嵌 WEBP(VP8X)：正确量尺寸并通过', async () => {
  const buffer = await makeXlsxWithMedia('xl/media/image1.webp', webp)
  await verifyOfficeZip(buffer, 'spreadsheet')
})

await check('docx 内嵌 EMF：同样跳过图片、正文可预览', async () => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>')
  zip.file('word/media/image1.emf', emf)
  const buffer = await zip.generateAsync({ type: 'arraybuffer' })
  await verifyOfficeZip(buffer, 'document')
})

console.log(`Office 内嵌图片校验通过（${passed} 项）`)
