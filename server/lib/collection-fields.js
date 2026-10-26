// 收集任务自定义字段的类型与校验规则。
// 前端 src/lib/collection-fields.js 保持同一套类型，避免两端提示不一致。
export const COLLECTION_FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'phone', 'email', 'select', 'date'])

export function collectionFieldTypeLabel(type) {
  return {
    text: '单行文本',
    textarea: '多行文本',
    number: '数字',
    phone: '手机号',
    email: '邮箱',
    select: '下拉选择',
    date: '日期选择',
  }[type] || '单行文本'
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
  if (field.type === 'number' && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return `字段「${field.label}」请填写有效数字`
  if (field.type === 'phone' && !/^(?:\+?86[-\s]?)?1[3-9]\d{9}$/.test(value.replace(/[\s-]/g, ''))) return `字段「${field.label}」请填写有效的手机号`
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `字段「${field.label}」请填写有效的邮箱地址`
  if (field.type === 'select' && Array.isArray(field.options) && field.options.length && !field.options.includes(value)) return `字段「${field.label}」请选择有效选项`
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `字段「${field.label}」日期格式不正确`
  return ''
}
