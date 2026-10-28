// 收集任务自定义字段：与 server/lib/collection-fields.js 保持同一套类型和提示。
export const COLLECTION_FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'phone', 'email', 'select', 'date'])

export const COLLECTION_FIELD_TYPE_OPTIONS = Object.freeze([
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'phone', label: '手机号' },
  { value: 'email', label: '邮箱' },
  { value: 'select', label: '下拉选择' },
  { value: 'date', label: '日期选择' },
])

export function collectionFieldTypeLabel(type) {
  return COLLECTION_FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label || '单行文本'
}

export function collectionFieldInputType(type) {
  if (type === 'number') return 'number'
  if (type === 'phone') return 'tel'
  if (type === 'email') return 'email'
  if (type === 'date') return 'date'
  return 'text'
}

export function collectionFieldValue(field, raw) {
  return raw === undefined || raw === null ? '' : String(raw).trim()
}

export function isCollectionFieldVisible(field, fields = [], values = {}, seen = new Set()) {
  const condition = field?.showWhen
  if (!condition?.fieldId) return true
  if (seen.has(field.id)) return false
  const controller = fields.find((item) => item.id === condition.fieldId)
  if (!controller) return false
  if (!isCollectionFieldVisible(controller, fields, values, new Set([...seen, field.id]))) return false
  return String(values?.[controller.id] ?? '').trim() === String(condition.value ?? '').trim()
}

export function visibleCollectionFields(fields = [], values = {}) {
  return fields.filter((field) => isCollectionFieldVisible(field, fields, values))
}

export function collectionFieldValueError(field, raw) {
  const value = collectionFieldValue(field, raw)
  if (!value) return field.required ? `请填写必填项：${field.label}` : ''
  const maxLength = field.type === 'text' ? 100 : field.type === 'select' ? 40 : field.type === 'date' ? 10 : 500
  if (value.length > maxLength) return `字段「${field.label}」不能超过 ${maxLength} 个字符`
  if (field.type === 'number' && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return `字段「${field.label}」请填写有效数字`
  if (field.type === 'phone' && !/^(?:\+?86[-\s]?)?1[3-9]\d{9}$/.test(value.replace(/[\s-]/g, ''))) return `字段「${field.label}」请填写有效的手机号`
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `字段「${field.label}」请填写有效的邮箱地址`
  if (field.type === 'select' && Array.isArray(field.options) && field.options.length && !field.options.includes(value)) return `字段「${field.label}」请选择有效选项`
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `字段「${field.label}」日期格式不正确`
  return ''
}

export function normalizeCollectionFieldOptions(value) {
  const options = String(value || '')
    .split(/[,，;；\n]/)
    .map((option) => option.trim())
    .filter(Boolean)
  return [...new Set(options)].slice(0, 30)
}
