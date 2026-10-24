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

export function applyCollectionNaming(task, files, submitterName, fileMaterialIds = []) {
  const materials = Array.isArray(task?.materials) ? task.materials : []
  if (!materials.some((material) => material.namingPattern)) return files
  if (!Array.isArray(fileMaterialIds) || fileMaterialIds.length !== files.length) {
    const error = new Error('请为每个文件指定对应的材料项')
    error.status = 400
    throw error
  }

  const materialById = new Map(materials.map((material) => [material.id, material]))
  const usedPaths = new Set()
  return files.map((file, index) => {
    const materialId = String(fileMaterialIds[index] || '')
    const material = materialById.get(materialId)
    if (!material) {
      const error = new Error('文件只能对应本次已选择的有效材料项')
      error.status = 400
      throw error
    }
    const originalName = String(file.originalName || file.originalname || file.name || '').split(/[\\/]/).at(-1) || '未命名文件'
    const originalRelativePath = String(file.originalRelativePath || file.relativePath || file.originalname || file.name || originalName)
    const originalParts = originalRelativePath.replaceAll('\\', '/').split('/')
    const directory = originalParts.length > 1 ? originalParts.slice(0, -1).join('/') : ''
    const proposedName = material.namingPattern
      ? renderCollectionFilename(material.namingPattern, { 提交人: submitterName, 材料项: material.name, 原文件名: originalName }, originalName)
      : originalName
    let name = sanitizeCollectionFilename(proposedName, originalName)
    let relativePath = directory ? `${directory}/${name}` : name
    let count = 2
    while (usedPaths.has(relativePath.toLocaleLowerCase())) {
      name = addCollectionFilenameSuffix(proposedName, count, originalName)
      relativePath = directory ? `${directory}/${name}` : name
      count += 1
    }
    usedPaths.add(relativePath.toLocaleLowerCase())
    return { ...file, name, relativePath, originalName, originalRelativePath, materialId }
  })
}
