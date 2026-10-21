import * as XLSX from 'xlsx'
import { OFFICE_PREVIEW_LIMITS } from './office-preview-core.js'
export * from './office-preview-core.js'

function limitError(detail) {
  return new Error(`${detail}，已停止预览，请下载后查看完整文件。`)
}

export function spreadsheetSheetInfo(sheet) {
  const reference = sheet?.['!fullref'] || sheet?.['!ref']
  if (!reference) return { range: null, rows: 0, columns: 0, cells: 0, pages: 1 }
  if (typeof reference !== 'string' || !/^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/.test(reference)) throw new Error('工作表区域无效，无法预览。')
  const range = XLSX.utils.decode_range(reference)
  const rows = range.e.r - range.s.r + 1, columns = range.e.c - range.s.c + 1
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1) throw new Error('工作表区域无效，无法预览。')
  if (rows > OFFICE_PREVIEW_LIMITS.maxRows || columns > OFFICE_PREVIEW_LIMITS.maxColumns || rows * columns > OFFICE_PREVIEW_LIMITS.maxCellsPerSheet) throw limitError(`工作表超过 ${OFFICE_PREVIEW_LIMITS.maxRows} 行、${OFFICE_PREVIEW_LIMITS.maxColumns} 列或 ${OFFICE_PREVIEW_LIMITS.maxCellsPerSheet} 单元格预览上限`)
  return { range, rows, columns, cells: rows * columns, pages: Math.ceil(rows / OFFICE_PREVIEW_LIMITS.rowsPerPage) }
}

export function validatePreviewWorkbook(workbook) {
  if (!workbook?.SheetNames?.length) throw new Error('表格中没有可显示的工作表')
  if (workbook.SheetNames.length > OFFICE_PREVIEW_LIMITS.maxSheets) throw limitError(`工作表超过 ${OFFICE_PREVIEW_LIMITS.maxSheets} 个预览上限`)
  let cells = 0, textBytes = 0
  return workbook.SheetNames.map((name) => {
    if (typeof name !== 'string' || name.length > 80) throw limitError('工作表名称超过预览上限')
    const sheet = workbook.Sheets[name], info = spreadsheetSheetInfo(sheet)
    cells += info.cells
    if (cells > OFFICE_PREVIEW_LIMITS.maxWorkbookCells) throw limitError('表格单元格总数超过预览上限')
    for (const [address, cell] of Object.entries(sheet || {})) {
      if (address.startsWith('!')) continue
      const text = String(cell?.w ?? cell?.v ?? '')
      if (text.length > OFFICE_PREVIEW_LIMITS.maxCellText) throw limitError('表格单元格文本超过预览上限')
      textBytes += text.length
      if (textBytes > OFFICE_PREVIEW_LIMITS.maxHtmlBytes) throw limitError('表格文本总量超过预览上限')
    }
    return { name, rows: info.rows, columns: info.columns, pages: info.pages }
  })
}

// Build only the requested bounded page. In particular, !ref from an attacker
// never reaches sheet_to_html unchecked, and hidden sheet pages are not in DOM.
export function spreadsheetSheetPage(sheet, page = 0) {
  const info = spreadsheetSheetInfo(sheet)
  if (!info.range) return { html: '<div class="spreadsheet-empty">此工作表为空</div>', page: 0, pages: 1, rows: 0 }
  if (!Number.isInteger(page) || page < 0 || page >= info.pages) throw new Error('工作表预览页码无效')
  const range = { s: { ...info.range.s, r: info.range.s.r + page * OFFICE_PREVIEW_LIMITS.rowsPerPage }, e: { ...info.range.e } }
  range.e.r = Math.min(range.e.r, range.s.r + OFFICE_PREVIEW_LIMITS.rowsPerPage - 1)
  const bounded = { '!ref': XLSX.utils.encode_range(range) }
  for (let row = range.s.r; row <= range.e.r; row++) for (let column = range.s.c; column <= range.e.c; column++) {
    const address = XLSX.utils.encode_cell({ r: row, c: column }), cell = sheet[address]
    if (cell) {
      if (String(cell.w ?? cell.v ?? '').length > OFFICE_PREVIEW_LIMITS.maxCellText) throw limitError('表格单元格文本超过预览上限')
      // XLSX supports raw HTML in cell.h. Preview formatted values and links;
      // sanitization still runs on the returned HTML at the UI boundary.
      const { h, ...safeCell } = cell
      bounded[address] = safeCell
    }
  }
  const html = XLSX.utils.sheet_to_html(bounded, { editable: false, header: '', footer: '' })
  if (html.length > OFFICE_PREVIEW_LIMITS.maxHtmlBytes) throw limitError('表格页面内容超过预览上限')
  return { html, page, pages: info.pages, rows: info.rows }
}

export function spreadsheetSheetHtml(sheet) { return spreadsheetSheetPage(sheet).html }
