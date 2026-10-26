import { createToken, httpError } from './http.js'
import { booleanInput, textInput } from './input-validation.js'
import { COLLECTION_FILENAME_PATTERN_MAX, COLLECTION_FILENAME_TOKENS } from './collection-naming.js'
import { COLLECTION_FIELD_TYPES, collectionFieldValueError, isCollectionFieldVisible } from './collection-fields.js'

const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function formArray(value, label, maxItems) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw httpError(400, `${label}格式不正确`)
  if (value.length > maxItems) throw httpError(400, `${label}最多设置 ${maxItems} 项`)
  return value
}

function formId(value, label) {
  const id = value === undefined || value === null || value === '' ? createToken(10) : String(value)
  if (!FIELD_ID_PATTERN.test(id)) throw httpError(400, `${label}标识格式不正确`)
  return id
}

export function normalizeCollectionMaterials(value) {
  const items = formArray(value, '材料项', 30)
  const seen = new Set()
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(400, `第 ${index + 1} 个材料项格式不正确`)
    const id = formId(item.id, '材料项')
    if (seen.has(id)) throw httpError(400, '材料项标识不能重复')
    seen.add(id)
    const name = textInput(item.name, '材料名称', 40)
    if (!name) throw httpError(400, '请填写材料名称')
    const namingPattern = item.namingPattern === undefined || item.namingPattern === null
      ? ''
      : textInput(item.namingPattern, '材料命名格式', COLLECTION_FILENAME_PATTERN_MAX, { optional: true })
    const placeholders = namingPattern.match(/\{[^{}]*\}/g) || []
    if (placeholders.some((token) => !COLLECTION_FILENAME_TOKENS.includes(token.slice(1, -1))) || /[{}]/.test(namingPattern.replace(/\{[^{}]*\}/g, ''))) {
      throw httpError(400, `材料「${name}」的命名格式包含不支持的占位符`)
    }
    return { id, name, required: booleanInput(item.required ?? false, '材料必交设置'), ...(namingPattern ? { namingPattern } : {}) }
  })
}

export function normalizeCollectionCustomFields(value) {
  const items = formArray(value, '自定义字段', 20)
  const seen = new Set()
  const fields = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(400, `第 ${index + 1} 个自定义字段格式不正确`)
    const id = formId(item.id, '字段')
    if (seen.has(id)) throw httpError(400, '自定义字段标识不能重复')
    seen.add(id)
    const label = textInput(item.label, '字段名称', 40)
    if (!label) throw httpError(400, '请填写字段名称')
    const type = String(item.type || 'text')
    if (!COLLECTION_FIELD_TYPES.includes(type)) throw httpError(400, `字段「${label}」类型不支持`)
    const field = { id, label, type, required: booleanInput(item.required ?? false, '字段必填设置') }
    if (Object.prototype.hasOwnProperty.call(item, 'help')) {
      const help = textInput(item.help ?? '', '字段填写提示', 120, { optional: true })
      if (help) field.help = help
    }
    if (type === 'select') {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 30) throw httpError(400, `字段「${label}」的选项需要设置 2 到 30 项`)
      const options = item.options.map((option) => textInput(option, '下拉选项', 40)).filter(Boolean)
      if (options.length < 2 || new Set(options).size !== options.length) throw httpError(400, `字段「${label}」的下拉选项不能为空或重复`)
      field.options = options
    }
    if (item.showWhen !== undefined && item.showWhen !== null) {
      if (typeof item.showWhen !== 'object' || Array.isArray(item.showWhen)) throw httpError(400, `字段「${label}」的显示条件格式不正确`)
      const fieldId = String(item.showWhen.fieldId || '')
      if (!FIELD_ID_PATTERN.test(fieldId)) throw httpError(400, `字段「${label}」的显示条件格式不正确`)
      const conditionValue = textInput(item.showWhen.value, '显示条件', 40)
      if (!conditionValue) throw httpError(400, `字段「${label}」请选择显示条件`)
      field.showWhen = { fieldId, value: conditionValue }
    }
    return field
  })
  const byId = new Map(fields.map((field) => [field.id, field]))
  for (const field of fields) {
    if (!field.showWhen) continue
    const controller = byId.get(field.showWhen.fieldId)
    if (!controller) throw httpError(400, `字段「${field.label}」的显示条件引用了不存在的字段`)
    if (controller.id === field.id) throw httpError(400, `字段「${field.label}」不能依赖自身显示`)
    if (controller.type !== 'select' || !controller.options?.includes(field.showWhen.value)) throw httpError(400, `字段「${field.label}」的显示条件无效`)
    const visited = new Set([field.id])
    let current = controller
    while (current?.showWhen) {
      if (visited.has(current.id)) throw httpError(400, `字段「${field.label}」的显示条件存在循环依赖`)
      visited.add(current.id)
      current = byId.get(current.showWhen.fieldId)
    }
  }
  return fields
}

function parseSubmittedJson(value, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') return value
  if (value.length > 32768) throw httpError(400, `${label}内容过长`)
  try { return JSON.parse(value) } catch { throw httpError(400, `${label}格式不正确`) }
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function validateCollectionSubmissionInput(task, fieldValuesInput, materialIdsInput, fileMaterialIdsInput, fileCount = 0) {
  const fieldValues = parseSubmittedJson(fieldValuesInput, '自定义字段', {})
  const materialIds = parseSubmittedJson(materialIdsInput, '材料选择', [])
  const fileMaterialIds = parseSubmittedJson(fileMaterialIdsInput, '文件材料对应关系', [])
  if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) throw httpError(400, '自定义字段格式不正确')
  if (!Array.isArray(materialIds)) throw httpError(400, '材料选择格式不正确')
  if (!Array.isArray(fileMaterialIds)) throw httpError(400, '文件材料对应关系格式不正确')
  const fields = Array.isArray(task.customFields) ? task.customFields : []
  const materials = Array.isArray(task.materials) ? task.materials : []
  const knownFieldIds = new Set(fields.map((field) => field.id))
  for (const id of Object.keys(fieldValues)) if (!knownFieldIds.has(id)) throw httpError(400, '包含当前任务不存在的自定义字段')
  const normalizedValues = {}
  for (const field of fields) {
    // 条件字段只在条件成立时参与必填和类型校验；隐藏字段即使带了旧值也不会入库。
    if (!isCollectionFieldVisible(field, fields, fieldValues)) continue
    const raw = fieldValues[field.id]
    const max = field.type === 'select' ? 40 : 500
    const value = raw === undefined || raw === null ? '' : textInput(raw, `字段「${field.label}」`, max, {
      optional: true,
      multiline: field.type === 'textarea' || field.type === 'text',
    })
    const error = collectionFieldValueError(field, value)
    if (error) throw httpError(400, error)
    if (value && field.type === 'select' && !field.options?.includes(value)) throw httpError(400, `字段「${field.label}」请选择有效选项`)
    if (value && field.type === 'date' && !isDateOnly(value)) throw httpError(400, `字段「${field.label}」日期格式不正确`)
    if (value) normalizedValues[field.id] = value
  }
  const knownMaterialIds = new Set(materials.map((material) => material.id))
  const normalizedMaterialIds = [...new Set(materialIds.map((id) => String(id)))]
  if (normalizedMaterialIds.some((id) => !knownMaterialIds.has(id))) throw httpError(400, '包含当前任务不存在的材料项')
  if (materials.length && !normalizedMaterialIds.length) throw httpError(400, '请选择本次要提交的材料项')
  const namingRequired = materials.some((material) => Boolean(material.namingPattern))
  if (fileCount > 0 && namingRequired && fileMaterialIds.length !== fileCount) throw httpError(400, '请为每个文件指定对应的材料项')
  if (fileMaterialIds.length && (fileCount > 0 && fileMaterialIds.length !== fileCount)) throw httpError(400, '文件材料对应关系与文件数量不一致')
  const submittedFileMaterialIds = fileMaterialIds.map((id) => String(id ?? '').trim())
  if (namingRequired && submittedFileMaterialIds.some((id) => !id)) throw httpError(400, '请为每个文件指定对应的材料项')
  // 旧版提交页会在未配置命名规则时按文件发送空字符串占位；这时文件无需关联材料。
  const normalizedFileMaterialIds = submittedFileMaterialIds.filter(Boolean)
  if (normalizedFileMaterialIds.some((id) => !knownMaterialIds.has(id) || !normalizedMaterialIds.includes(id))) throw httpError(400, '文件只能对应本次已选择的有效材料项')
  return { fieldValues: normalizedValues, materialIds: normalizedMaterialIds, fileMaterialIds: normalizedFileMaterialIds }
}
