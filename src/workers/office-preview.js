import { OFFICE_PREVIEW_LIMITS, assertPreviewHtmlBudget, verifyOfficeZip } from '../lib/office-preview-core.js'

let workbook = null
export async function parseOfficePreview(buffer, kind) {
  await verifyOfficeZip(buffer, kind)
  if (kind === 'document') {
    const { default: mammoth } = await import('mammoth/mammoth.browser.min.js')
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
    if (!result.value.trim()) throw new Error('文档没有可显示的正文内容')
    assertPreviewHtmlBudget(result.value)
    return { html: result.value }
  }
  if (kind === 'spreadsheet') {
    const { spreadsheetSheetPage, validatePreviewWorkbook } = await import('../lib/office-preview.js')
    const XLSX = await import('xlsx')
    const names = XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames
    if (names.length > OFFICE_PREVIEW_LIMITS.maxSheets) throw new Error(`工作表超过 ${OFFICE_PREVIEW_LIMITS.maxSheets} 个预览上限，请下载后查看。`)
    // !fullref preserves the declared range when parsing stops at sheetRows.
    const parsed = XLSX.read(buffer, { type: 'array', cellDates: true, cellHTML: false, sheetRows: OFFICE_PREVIEW_LIMITS.maxRows + 1 })
    const sheets = validatePreviewWorkbook(parsed)
    workbook = parsed
    return { sheets, ...spreadsheetSheetPage(parsed.Sheets[names[0]]) }
  }
  if (kind === 'presentation') return { buffer }
  throw new Error('不支持的 Office 预览类型')
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') self.onmessage = async ({ data }) => {
  try {
    const result = data.type === 'parse' ? await parseOfficePreview(data.buffer, data.kind)
      : spreadsheetSheetPage(workbook?.Sheets[workbook.SheetNames[data.sheet]], data.page)
    const transfer = result.buffer ? [result.buffer] : []
    self.postMessage({ id: data.id, result }, transfer)
  } catch (error) { self.postMessage({ id: data.id, error: error.message || 'Office 解析失败' }) }
}
