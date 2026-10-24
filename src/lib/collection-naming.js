export const COLLECTION_FILENAME_TOKENS = Object.freeze(['提交人', '材料项', '原文件名'])
export const COLLECTION_FILENAME_PATTERN_MAX = 180

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function byteLength(value) { return new TextEncoder().encode(String(value || '')).length }
function takeWithinBytes(value, maxBytes) {
  let result = ''; let used = 0
  for (const character of String(value)) {
    const size = byteLength(character)
    if (used + size > maxBytes) break
    result += character; used += size
  }
  return result
}
function extensionOf(name) {
  const basename = String(name || '').split(/[\\/]/).at(-1) || ''
  const index = basename.lastIndexOf('.')
  return index > 0 ? basename.slice(index) : ''
}
export function sanitizeCollectionFilename(value, originalName = '') {
  const sourceExtension = extensionOf(originalName)
  let name = String(value || '').replace(ILLEGAL_FILENAME_CHARS, '_').replace(/[. ]+$/g, '').trim()
  if (!name || name === '.' || name === '..') name = '未命名文件'
  const generatedExtension = extensionOf(name)
  if (sourceExtension && generatedExtension.toLowerCase() !== sourceExtension.toLowerCase()) name = `${generatedExtension ? name.slice(0, -generatedExtension.length) : name}${sourceExtension}`
  if (WINDOWS_RESERVED_NAME.test(name)) name = `_${name}`
  const extension = extensionOf(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  const safeStem = takeWithinBytes(stem || '文件', Math.max(1, 240 - byteLength(extension)))
  return `${safeStem || '文件'}${extension}`
}
export function renderCollectionFilename(pattern, values, originalName) {
  const rendered = String(pattern || '').replace(/\{([^{}]+)\}/g, (token, key) => COLLECTION_FILENAME_TOKENS.includes(key) ? String(values?.[key] || '') : token)
  return sanitizeCollectionFilename(rendered, originalName)
}
export function addCollectionFilenameSuffix(filename, suffix, originalName = filename) {
  const safe = sanitizeCollectionFilename(filename, originalName)
  const extension = extensionOf(safe)
  const stem = extension ? safe.slice(0, -extension.length) : safe
  const ending = ` (${suffix})${extension}`
  return `${takeWithinBytes(stem, Math.max(1, 240 - byteLength(ending))) || '文件'}${ending}`
}
