import path from 'node:path'
import { integerInput, objectInput, textInput } from './input-validation.js'
import { httpError } from './http.js'

export function fileNameInput(value) {
  const name = textInput(value, '文件名', 240, { trim:false })
  if (Buffer.byteLength(name,'utf8') > 240 || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..') throw httpError(400, '文件名包含不支持的字符或过长')
  return name
}
export function relativePathInput(value, name) {
  const raw = textInput(value, '文件相对路径', 1024, { trim:false }).replaceAll('\\','/')
  const parts = raw.split('/')
  if (parts.length > 20 || Buffer.byteLength(raw,'utf8') > 1024 || parts.some(part => !part || part === '.' || part === '..')) throw httpError(400, '文件路径层级过深或格式不正确')
  parts.forEach(fileNameInput)
  if (name && parts.at(-1) !== name) throw httpError(400, '文件名与相对路径不一致')
  return parts.join('/')
}
export function mimeInput(value) {
  if (value === undefined || value === '') return 'application/octet-stream'
  const mime = textInput(value, '文件类型', 100, {trim:false})
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) throw httpError(400, '文件类型格式不正确')
  return mime.toLowerCase()
}
export function fileMetadataInput(file) {
  objectInput(file)
  const name = fileNameInput(file.name)
  const relativePath = relativePathInput(file.relativePath === undefined || file.relativePath === '' ? name : file.relativePath, name)
  const size = integerInput(file.size, '文件大小', 0, Number.MAX_SAFE_INTEGER, {string:false})
  return {name,relativePath,size,mimeType:mimeInput(file.mimeType)}
}
export function relativePathsInput(value, files) {
  let paths = value
  if (value === undefined) return files.map(file => relativePathInput(file.relativePath || file.name || file.originalname, file.name || file.originalname))
  if (typeof value === 'string') { try { paths = JSON.parse(value) } catch { throw httpError(400, '文件路径列表格式不正确') } }
  if (!Array.isArray(paths) || paths.length !== files.length) throw httpError(400, '文件路径列表须与文件数量一致')
  return paths.map((value,index) => relativePathInput(value, files[index].name || files[index].originalname))
}
export function uniqueFilePaths(files) {
  const seen = new Set()
  for (const file of files) {
    const key = path.posix.normalize(file.relativePath).toLowerCase()
    if (seen.has(key)) throw httpError(400, '同一次上传不能包含重复文件路径')
    seen.add(key)
  }
}
