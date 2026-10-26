import { COLLECTION_FILENAME_PATTERN_MAX, COLLECTION_FILENAME_TOKENS, renderCollectionFilename } from './collection-naming.js'
import { normalizeCollectionFieldOptions } from './collection-fields.js'

export const COLLECTION_DRAFT_KEY = 'kunqiong.collection.draft.v1'
export const COLLECTION_STRUCTURE_KEY = 'kunqiong.collection.structures.v1'
export const COLLECTION_MATERIAL_LIMIT = 30
export const COLLECTION_FIELD_LIMIT = 20

export const COLLECTION_MATERIAL_TEMPLATES = Object.freeze([
  '营业执照',
  '身份证正反面',
  '合同文件',
  '发票',
  '报价单',
  '资质证书',
  '产品图片',
  '品牌 Logo',
  '项目文件',
  '其他材料',
])

export const COLLECTION_FIELD_TEMPLATES = Object.freeze([
  { label: '联系人', type: 'text', required: true, help: '请填写可以联系到你的姓名' },
  { label: '联系电话', type: 'phone', required: true, help: '例如：13800138000' },
  { label: '邮箱', type: 'email', required: false, help: '用于接收后续通知' },
  { label: '公司名称', type: 'text', required: false, help: '' },
  { label: '供应商类型', type: 'select', required: true, options: ['生产商', '经销商', '服务商'], help: '' },
  { label: '备注', type: 'textarea', required: false, help: '可以补充说明材料内容' },
])

export const COLLECTION_NAMING_PRESETS = Object.freeze([
  { label: '原文件名', pattern: '{原文件名}' },
  { label: '提交人_原文件名', pattern: '{提交人}_{原文件名}' },
  { label: '提交人_材料项_原文件名', pattern: '{提交人}_{材料项}_{原文件名}' },
  { label: '材料项_提交人_原文件名', pattern: '{材料项}_{提交人}_{原文件名}' },
])

export const COLLECTION_SCENARIOS = Object.freeze([
  {
    id: 'supplier',
    name: '供应商资料',
    hint: '营业执照、资质、报价与联系人',
    materials: [
      { name: '营业执照', required: true, namingPattern: '{提交人}_{材料项}_{原文件名}' },
      { name: '资质证书', required: false, namingPattern: '{提交人}_{材料项}_{原文件名}' },
      { name: '报价单', required: true },
    ],
    customFields: [
      { label: '供应商类型', type: 'select', required: true, options: ['生产商', '经销商', '服务商'] },
      { label: '公司名称', type: 'text', required: true },
      { label: '联系人', type: 'text', required: true },
      { label: '联系电话', type: 'phone', required: true },
      { label: '邮箱', type: 'email', required: false },
      { label: '备注', type: 'textarea', required: false },
    ],
  },
  {
    id: 'campaign',
    name: '活动素材',
    hint: '图片、Logo、文案与视频',
    materials: [
      { name: '产品图片', required: true },
      { name: '品牌 Logo', required: true },
      { name: '宣传文案', required: false },
      { name: '视频素材', required: false },
    ],
    customFields: [
      { label: '联系人', type: 'text', required: true },
      { label: '联系电话', type: 'phone', required: true },
      { label: '提交说明', type: 'textarea', required: false, help: '说明素材的使用场景或注意事项' },
    ],
  },
  {
    id: 'onboarding',
    name: '入职资料',
    hint: '身份证、学历、银行卡与联系方式',
    materials: [
      { name: '身份证正反面', required: true },
      { name: '学历证明', required: true },
      { name: '银行卡信息', required: true },
    ],
    customFields: [
      { label: '姓名', type: 'text', required: true },
      { label: '手机号', type: 'phone', required: true },
      { label: '邮箱', type: 'email', required: false },
      { label: '入职日期', type: 'date', required: true },
    ],
  },
  {
    id: 'reimbursement',
    name: '发票报销',
    hint: '发票、付款凭证与报销信息',
    materials: [
      { name: '发票', required: true, namingPattern: '{提交人}_{材料项}_{原文件名}' },
      { name: '付款凭证', required: true },
    ],
    customFields: [
      { label: '报销人', type: 'text', required: true },
      { label: '费用类型', type: 'select', required: true, options: ['差旅', '办公', '招待', '其他'] },
      { label: '金额', type: 'number', required: true, help: '填写含税金额，例如 1280.50' },
      { label: '备注', type: 'textarea', required: false },
    ],
  },
  {
    id: 'general',
    name: '通用文件',
    hint: '只收集文件，附一条备注',
    materials: [{ name: '项目文件', required: true }],
    customFields: [{ label: '备注', type: 'textarea', required: false }],
  },
])

export function newCollectionItemId(prefix = 'item') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
}

export function createCollectionMaterial(name = '', options = {}) {
  return {
    id: newCollectionItemId('mat'),
    name,
    required: options.required ?? true,
    ...(options.namingPattern ? { namingPattern: options.namingPattern } : {}),
  }
}

export function createCollectionField(label = '', options = {}) {
  const type = options.type || 'text'
  return {
    id: newCollectionItemId('field'),
    label,
    type,
    required: options.required ?? false,
    ...(type === 'select' ? { options: options.options?.length >= 2 ? [...options.options] : ['选项一', '选项二'] } : {}),
    ...(options.help ? { help: options.help } : {}),
    ...(options.showWhen?.fieldId ? { showWhen: { fieldId: options.showWhen.fieldId, value: options.showWhen.value } } : {}),
  }
}

function cloneMaterial(material) {
  return {
    id: material.id || newCollectionItemId('mat'),
    name: String(material.name || ''),
    required: Boolean(material.required),
    ...(material.namingPattern ? { namingPattern: String(material.namingPattern) } : {}),
  }
}

function cloneField(field) {
  return {
    id: field.id || newCollectionItemId('field'),
    label: String(field.label || ''),
    type: field.type || 'text',
    required: Boolean(field.required),
    ...(field.type === 'select' && Array.isArray(field.options) ? { options: field.options.map((option) => String(option)) } : {}),
    ...(field.help ? { help: String(field.help) } : {}),
    ...(field.showWhen?.fieldId ? { showWhen: { fieldId: field.showWhen.fieldId, value: field.showWhen.value } } : {}),
  }
}

export function collectionStructureFromTask(task = {}) {
  return {
    materials: (Array.isArray(task.materials) ? task.materials : []).map(cloneMaterial),
    customFields: (Array.isArray(task.customFields) ? task.customFields : []).map(cloneField),
  }
}

function hasStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function hasCollectionDraftContent(form = {}) {
  return Boolean(
    String(form.title || '').trim()
    || String(form.description || '').trim()
    || (Array.isArray(form.materials) && form.materials.length)
    || (Array.isArray(form.customFields) && form.customFields.length),
  )
}

export function loadCollectionDraft(defaults = {}) {
  if (!hasStorage()) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLECTION_DRAFT_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const draft = {
      ...defaults,
      ...parsed,
      title: String(parsed.title || defaults.title || ''),
      description: String(parsed.description || defaults.description || ''),
      deadline: String(parsed.deadline || defaults.deadline || ''),
      allowedTypes: Array.isArray(parsed.allowedTypes) ? parsed.allowedTypes : (defaults.allowedTypes || ['全部格式']),
      maxFileSizeMb: Number(parsed.maxFileSizeMb) || defaults.maxFileSizeMb || 500,
      materials: (Array.isArray(parsed.materials) ? parsed.materials : []).map(cloneMaterial),
      customFields: (Array.isArray(parsed.customFields) ? parsed.customFields : []).map(cloneField),
    }
    return hasCollectionDraftContent(draft) ? draft : null
  } catch {
    return null
  }
}

export function saveCollectionDraft(form = {}) {
  if (!hasStorage()) return false
  try {
    window.localStorage.setItem(COLLECTION_DRAFT_KEY, JSON.stringify({
      title: form.title || '',
      description: form.description || '',
      deadline: form.deadline || '',
      allowedTypes: form.allowedTypes || ['全部格式'],
      maxFileSizeMb: form.maxFileSizeMb || 500,
      materials: (form.materials || []).map(cloneMaterial),
      customFields: (form.customFields || []).map(cloneField),
      savedAt: Date.now(),
    }))
    return true
  } catch {
    return false
  }
}

export function clearCollectionDraft() {
  if (!hasStorage()) return
  try { window.localStorage.removeItem(COLLECTION_DRAFT_KEY) } catch { /* 草稿写入失败不影响创建任务 */ }
}

export function readSavedCollectionStructures() {
  if (!hasStorage()) return []
  try {
    const list = JSON.parse(window.localStorage.getItem(COLLECTION_STRUCTURE_KEY) || '[]')
    if (!Array.isArray(list)) return []
    return list.filter((item) => item && item.id && item.name).map((item) => ({
      id: String(item.id),
      name: String(item.name).slice(0, 40),
      savedAt: Number(item.savedAt) || Date.now(),
      materials: (Array.isArray(item.materials) ? item.materials : []).map(cloneMaterial),
      customFields: (Array.isArray(item.customFields) ? item.customFields : []).map(cloneField),
    }))
  } catch {
    return []
  }
}

export function saveCollectionStructure(name, form = {}) {
  if (!hasStorage()) return null
  const title = String(name || '').trim().slice(0, 40) || '未命名结构'
  const structure = {
    id: newCollectionItemId('structure'),
    name: title,
    savedAt: Date.now(),
    materials: (form.materials || []).map(cloneMaterial),
    customFields: (form.customFields || []).map(cloneField),
  }
  try {
    const list = readSavedCollectionStructures()
    const next = [structure, ...list.filter((item) => item.name !== title)].slice(0, 12)
    window.localStorage.setItem(COLLECTION_STRUCTURE_KEY, JSON.stringify(next))
    return structure
  } catch {
    return null
  }
}

export function deleteSavedCollectionStructure(id) {
  if (!hasStorage()) return []
  try {
    const next = readSavedCollectionStructures().filter((item) => item.id !== id)
    window.localStorage.setItem(COLLECTION_STRUCTURE_KEY, JSON.stringify(next))
    return next
  } catch {
    return readSavedCollectionStructures()
  }
}

export function mergeCollectionStructure(form = {}, source = {}) {
  const materials = Array.isArray(form.materials) ? [...form.materials] : []
  const customFields = Array.isArray(form.customFields) ? [...form.customFields] : []
  const materialNames = new Set(materials.map((material) => String(material.name || '').trim()).filter(Boolean))
  const fieldLabels = new Set(customFields.map((field) => String(field.label || '').trim()).filter(Boolean))
  // 复制已有任务/常用结构时，源字段 id 与新结构 id 不同；先记录源 id 到标签，再映射条件字段。
  const sourceFieldLabels = new Map((source.customFields || []).map((field) => [String(field.id || ''), String(field.label || '').trim()]))
  let skippedMaterials = 0
  let skippedFields = 0
  let addedMaterials = 0
  let addedFields = 0

  for (const material of source.materials || []) {
    if (materials.length >= COLLECTION_MATERIAL_LIMIT) { skippedMaterials += 1; continue }
    const name = String(material.name || '').trim().slice(0, 40)
    if (!name || materialNames.has(name)) { skippedMaterials += 1; continue }
    const next = createCollectionMaterial(name, {
      required: material.required,
      namingPattern: material.namingPattern || '',
    })
    materials.push(next)
    materialNames.add(name)
    addedMaterials += 1
  }

  const pendingFields = []
  for (const field of source.customFields || []) {
    if (customFields.length + pendingFields.length >= COLLECTION_FIELD_LIMIT) { skippedFields += 1; continue }
    const label = String(field.label || '').trim().slice(0, 40)
    if (!label || fieldLabels.has(label)) { skippedFields += 1; continue }
    const next = createCollectionField(label, {
      type: field.type,
      required: field.required,
      options: field.options,
      help: field.help,
    })
    pendingFields.push({ source: field, field: next })
    fieldLabels.add(label)
    addedFields += 1
  }

  const allFields = [...customFields, ...pendingFields.map((item) => item.field)]
  const byLabel = new Map(allFields.map((field) => [String(field.label || '').trim(), field]))
  for (const { source: sourceField, field } of pendingFields) {
    const conditionLabel = sourceField.showWhenLabel || sourceFieldLabels.get(String(sourceField.showWhen?.fieldId || '')) || ''
    const conditionValue = sourceField.showWhenValue || sourceField.showWhen?.value
    const controller = conditionLabel ? byLabel.get(String(conditionLabel).trim()) : null
    if (controller && controller.id !== field.id && controller.type === 'select' && (controller.options || []).includes(conditionValue)) {
      field.showWhen = { fieldId: controller.id, value: conditionValue }
    }
  }

  return {
    form: { ...form, materials, customFields: [...customFields, ...pendingFields.map((item) => item.field)] },
    addedMaterials,
    addedFields,
    skippedMaterials,
    skippedFields,
  }
}

function scenarioStructure(scenario) {
  return {
    materials: scenario.materials.map((material) => ({ ...material })),
    customFields: scenario.customFields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
  }
}

export function applyCollectionScenario(form, scenarioId) {
  const scenario = COLLECTION_SCENARIOS.find((item) => item.id === scenarioId)
  if (!scenario) return { form, addedMaterials: 0, addedFields: 0, skippedMaterials: 0, skippedFields: 0 }
  return mergeCollectionStructure(form, scenarioStructure(scenario))
}

export function generateCollectionStructure({ title = '', description = '' } = {}) {
  const text = `${title} ${description}`.toLowerCase()
  const materials = []
  const customFields = []
  const addMaterial = (name, options = {}) => {
    if (!materials.some((item) => item.name === name)) materials.push({ name, required: true, ...options })
  }
  const addField = (field) => {
    if (!customFields.some((item) => item.label === field.label)) customFields.push(field)
  }

  if (/营业执照|执照|资质|许可证/.test(text)) {
    addMaterial('营业执照', { namingPattern: '{提交人}_{材料项}_{原文件名}' })
    if (/资质|许可证/.test(text)) addMaterial('资质证书')
  }
  if (/身份证|实名|证件/.test(text)) addMaterial('身份证正反面')
  if (/合同|协议/.test(text)) addMaterial('合同文件', { namingPattern: '{提交人}_{材料项}_{原文件名}' })
  if (/发票/.test(text)) addMaterial('发票', { namingPattern: '{提交人}_{材料项}_{原文件名}' })
  if (/付款|支付|转账|凭证/.test(text)) addMaterial('付款凭证')
  if (/报价|询价|价格/.test(text)) addMaterial('报价单')
  if (/图片|照片|素材|海报/.test(text)) addMaterial('产品图片')
  if (/logo|标志|品牌/.test(text)) addMaterial('品牌 Logo')
  if (/视频|短片/.test(text)) addMaterial('视频素材')
  if (/简历|招聘|学历/.test(text)) {
    addMaterial('个人简历')
    addMaterial('学历证明')
  }
  if (/银行卡|账户|开户/.test(text)) addMaterial('银行卡信息')
  if (/检测|报告/.test(text)) addMaterial('检测报告')

  if (/企业|公司|供应商|主体/.test(text)) {
    addField({ label: '主体类型', type: 'select', required: true, options: ['企业', '个人'] })
    addField({ label: '公司名称', type: 'text', required: true, showWhenLabel: '主体类型', showWhenValue: '企业' })
    addField({ label: '统一社会信用代码', type: 'text', required: false, showWhenLabel: '主体类型', showWhenValue: '企业' })
  }
  if (/供应商/.test(text)) addField({ label: '供应商类型', type: 'select', required: false, options: ['生产商', '经销商', '服务商'] })
  if (/联系人|姓名|称呼/.test(text)) addField({ label: '联系人', type: 'text', required: true })
  if (/电话|手机|联系方式/.test(text)) addField({ label: '联系电话', type: 'phone', required: true })
  if (/邮箱|邮件|email/i.test(text)) addField({ label: '邮箱', type: 'email', required: false })
  if (/金额|费用|报销|报价/.test(text)) addField({ label: '金额', type: 'number', required: false, help: '填写数字金额，例如 1280.50' })
  if (/日期|时间|入职|截止/.test(text)) addField({ label: '提交日期', type: 'date', required: false })
  if (/备注|说明|补充/.test(text)) addField({ label: '备注', type: 'textarea', required: false })

  if (!materials.length) addMaterial('项目文件')
  if (!customFields.length) addField({ label: '备注', type: 'textarea', required: false })

  return { materials, customFields }
}

export function validateCollectionStructure(materials = [], customFields = []) {
  const materialErrors = {}
  const fieldErrors = {}
  const materialNames = new Map()

  materials.forEach((material, index) => {
    const errors = {}
    const name = String(material.name || '').trim()
    if (!name) errors.name = '请填写材料名称'
    else if (name.length > 40) errors.name = '材料名称不能超过 40 个字'
    else if (materialNames.has(name)) errors.name = `与第 ${materialNames.get(name) + 1} 项材料重名`
    else materialNames.set(name, index)

    const pattern = String(material.namingPattern || '')
    if (pattern) {
      if (pattern.length > COLLECTION_FILENAME_PATTERN_MAX) {
        errors.namingPattern = `命名格式不能超过 ${COLLECTION_FILENAME_PATTERN_MAX} 个字符`
      } else {
        const tokens = pattern.match(/\{[^{}]*\}/g) || []
        const invalidToken = tokens.find((token) => !COLLECTION_FILENAME_TOKENS.includes(token.slice(1, -1)))
        if (invalidToken) errors.namingPattern = `不支持占位符 ${invalidToken}`
        else if (/[{}]/.test(pattern.replace(/\{[^{}]*\}/g, ''))) errors.namingPattern = '占位符需要成对使用 { }'
      }
    }
    if (Object.keys(errors).length) materialErrors[material.id] = errors
  })

  const fieldLabels = new Map()
  customFields.forEach((field, index) => {
    const errors = {}
    const label = String(field.label || '').trim()
    if (!label) errors.label = '请填写字段名称'
    else if (label.length > 40) errors.label = '字段名称不能超过 40 个字'
    else if (fieldLabels.has(label)) errors.label = `与第 ${fieldLabels.get(label) + 1} 个字段重名`
    else fieldLabels.set(label, index)

    if (field.help && String(field.help).length > 120) errors.help = '填写提示不能超过 120 个字'
    if (field.type === 'select') {
      const options = Array.isArray(field.options) ? field.options.map((option) => String(option).trim()).filter(Boolean) : []
      if (options.length < 2) errors.options = '下拉选项至少需要 2 项'
      else if (options.length > 30) errors.options = '下拉选项最多 30 项'
      else if (new Set(options).size !== options.length) errors.options = '下拉选项不能重复'
    }
    if (Object.keys(errors).length) fieldErrors[field.id] = errors
  })

  customFields.forEach((field) => {
    if (!field.showWhen?.fieldId) return
    const errors = fieldErrors[field.id] || {}
    const controller = customFields.find((item) => item.id === field.showWhen.fieldId)
    if (!controller) errors.showWhen = '显示条件引用的字段不存在'
    else if (controller.id === field.id) errors.showWhen = '字段不能依赖自身显示'
    else if (controller.type !== 'select' || !(controller.options || []).includes(field.showWhen.value)) errors.showWhen = '请选择有效的显示条件'
    else {
      const visited = new Set([field.id])
      let current = controller
      while (current?.showWhen?.fieldId) {
        if (visited.has(current.id)) { errors.showWhen = '显示条件存在循环依赖'; break }
        visited.add(current.id)
        current = customFields.find((item) => item.id === current.showWhen.fieldId)
      }
    }
    if (Object.keys(errors).length) fieldErrors[field.id] = errors
  })

  const errorCount = Object.values(materialErrors).reduce((sum, errors) => sum + Object.keys(errors).length, 0)
    + Object.values(fieldErrors).reduce((sum, errors) => sum + Object.keys(errors).length, 0)
  return { materialErrors, fieldErrors, errorCount, hasErrors: errorCount > 0 }
}

export function namingExample(material, submitterName = '张三') {
  const pattern = String(material?.namingPattern || '')
  if (!pattern) return ''
  return renderCollectionFilename(pattern, {
    提交人: submitterName,
    材料项: String(material?.name || '材料项'),
    原文件名: `${String(material?.name || '示例文件').replace(/[\\/:*?"<>|]/g, '') || '示例文件'}.pdf`,
  }, `${String(material?.name || '示例文件')}.pdf`)
}

export function appendNamingToken(pattern, token) {
  const current = String(pattern || '')
  const needsSeparator = current && !/[_{（(]$/.test(current) && !/}$/.test(current)
  return `${current}${needsSeparator ? '_' : ''}{${token}}`
}

export function parseBulkMaterials(value) {
  return String(value || '')
    .split(/[\n,，;；]/)
    .map((item) => item.trim().slice(0, 40))
    .filter(Boolean)
}

export function parseBulkFields(value) {
  const typeAliases = {
    文本: 'text', 单行: 'text', 单行文本: 'text',
    多行: 'textarea', 多行文本: 'textarea',
    数字: 'number',
    手机: 'phone', 手机号: 'phone',
    邮箱: 'email',
    下拉: 'select', 下拉选择: 'select', 选择: 'select',
    日期: 'date', 日期选择: 'date',
  }
  return String(value || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, typePart, optionPart] = line.split('|').map((item) => item.trim())
      const label = String(labelPart || '').slice(0, 40)
      if (!label) return null
      const type = typeAliases[typePart] || typePart || 'text'
      const options = optionPart ? normalizeCollectionFieldOptions(optionPart) : undefined
      return createCollectionField(label, {
        type: type === 'select' ? 'select' : type,
        options: type === 'select' ? options : undefined,
      })
    })
    .filter(Boolean)
}
