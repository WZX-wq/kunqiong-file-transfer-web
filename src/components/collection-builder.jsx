import React, { useEffect, useState } from 'react'
import {
  ArrowDown, ArrowUp, Bookmark, ChevronDown, ChevronUp, Copy, FolderOpen, GripVertical,
  Layers, Plus, Sparkles, Trash2, Wand2,
} from 'lucide-react'
import { PrototypeAsset } from './prototype-asset.jsx'
import { COLLECTION_FILENAME_PATTERN_MAX, COLLECTION_FILENAME_TOKENS } from '../lib/collection-naming.js'
import {
  COLLECTION_FIELD_TYPE_OPTIONS, collectionFieldInputType, normalizeCollectionFieldOptions, visibleCollectionFields,
} from '../lib/collection-fields.js'
import {
  COLLECTION_FIELD_LIMIT, COLLECTION_FIELD_TEMPLATES, COLLECTION_MATERIAL_LIMIT,
  COLLECTION_MATERIAL_TEMPLATES, COLLECTION_NAMING_PRESETS, COLLECTION_SCENARIOS,
  appendNamingToken, createCollectionField, createCollectionMaterial, deleteSavedCollectionStructure,
  generateCollectionStructure, namingExample, parseBulkMaterials,
  readSavedCollectionStructures, saveCollectionStructure,
} from '../lib/collection-form.js'
import { formatBytes } from '../lib/format.js'
import { formatAllowedTypes } from '../lib/records.js'

function CollectionPresetDisclosure({ label, count, children }) {
  return (
    <details className="collection-preset-disclosure">
      <summary>
        <span>{label}</span>
        <small>{count} 项</small>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="collection-quick-presets">{children}</div>
    </details>
  )
}

function MaterialRow({
  material, index, total, error, onUpdate, onRemove, onCopy, onMove, dragId, setDragId,
}) {
  const move = (direction) => {
    const next = Math.max(0, Math.min(total - 1, index + direction))
    if (next !== index) onMove(index, next)
  }
  return (
    <div
      className={`collection-rule-row collection-rule-row-v2 ${dragId === material.id ? 'dragging' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const fromIndex = Number(event.dataTransfer.getData('text/plain'))
        if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < total && fromIndex !== index) onMove(fromIndex, index)
        setDragId('')
      }}
    >
      <div className="collection-rule-main">
        <button
          type="button"
          className="collection-drag-handle"
          draggable
          aria-label={`拖动材料 ${index + 1} 排序`}
          title="拖动排序"
          onDragStart={(event) => {
            setDragId(material.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', String(index))
          }}
          onDragEnd={() => setDragId('')}
        >
          <GripVertical size={15} />
        </button>
        <label className="collection-rule-name">
          <span className="collection-inline-label">
            <span>材料名称</span>
            <small className={material.name.length >= 40 ? 'field-count at-limit' : 'field-count'}>{material.name.length}/40</small>
          </span>
          <input
            aria-label={`材料名称 ${index + 1}`}
            value={material.name}
            maxLength={40}
            autoFocus={material.autoFocus}
            onChange={(event) => onUpdate({ name: event.target.value })}
            placeholder="例如：营业执照"
          />
        </label>
        <label className="collection-rule-required">
          <input type="checkbox" checked={material.required} onChange={(event) => onUpdate({ required: event.target.checked })} />
          必交
        </label>
        <div className="collection-rule-actions">
          <button type="button" className="ghost-icon" disabled={index === 0} aria-label={`上移材料 ${index + 1}`} title="上移" onClick={() => move(-1)}><ArrowUp size={14} /></button>
          <button type="button" className="ghost-icon" disabled={index === total - 1} aria-label={`下移材料 ${index + 1}`} title="下移" onClick={() => move(1)}><ArrowDown size={14} /></button>
          <button type="button" className="ghost-icon" aria-label={`复制材料 ${index + 1}`} title="复制" onClick={onCopy}><Copy size={14} /></button>
          <button type="button" className="ghost-icon collection-rule-delete" aria-label={`删除材料 ${index + 1}`} title="删除材料" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
      {error?.name && <small className="collection-inline-error" role="alert">{error.name}</small>}
      <details className={`collection-naming-details${material.namingPattern ? ' has-pattern' : ''}`}>
        <summary>
          <span>自动命名</span>
          <small>{material.namingPattern ? '已设置' : '可选 · 默认保留原文件名'}</small>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="collection-material-naming-field">
          <label className="collection-naming-input-label">
            <span>命名格式</span>
            <input
              className="collection-material-naming"
              aria-label={`${material.name || `材料 ${index + 1}`}命名格式`}
              value={material.namingPattern || ''}
              maxLength={COLLECTION_FILENAME_PATTERN_MAX}
              onChange={(event) => onUpdate({ namingPattern: event.target.value })}
              placeholder="例如：{提交人}_{材料项}_{原文件名}"
            />
          </label>
          <div className="collection-naming-presets" aria-label="常用命名格式">
            <small>常用格式</small>
            {COLLECTION_NAMING_PRESETS.map((preset) => (
              <button key={preset.pattern} type="button" onClick={() => onUpdate({ namingPattern: preset.pattern })}>{preset.label}</button>
            ))}
          </div>
          <div className="collection-naming-tokens">
            <span>插入变量</span>
            {COLLECTION_FILENAME_TOKENS.map((token) => (
              <button key={token} type="button" onClick={() => onUpdate({ namingPattern: appendNamingToken(material.namingPattern, token) })}>{`{${token}}`}</button>
            ))}
          </div>
          {material.namingPattern
            ? <small className="collection-naming-example">示例：<code>{namingExample(material) || '示例文件.pdf'}</code></small>
            : <small className="collection-material-naming-preview">留空则保留原文件名</small>}
          {error?.namingPattern && <small className="collection-inline-error" role="alert">{error.namingPattern}</small>}
        </div>
      </details>
    </div>
  )
}

export function CollectionMaterialsEditor({
  materials = [], onChange, errors = {}, compact = false, headingId = 'collection-materials-heading',
  maxItems = COLLECTION_MATERIAL_LIMIT, showTemplates = true,
}) {
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [dragId, setDragId] = useState('')
  const [focusId, setFocusId] = useState('')
  const requiredCount = materials.filter((material) => material.required).length
  const visibleMaterials = expanded ? materials : materials.slice(0, 3)

  useEffect(() => {
    if (focusId && materials.findIndex((material) => material.id === focusId) >= 3) setExpanded(true)
  }, [focusId, materials])

  const replace = (next) => onChange(next)
  const addMaterial = (name = '', options = {}) => {
    if (materials.length >= maxItems) return
    const material = createCollectionMaterial(name, options)
    material.autoFocus = true
    setFocusId(material.id)
    replace([...materials, material])
  }
  const updateMaterial = (id, patch) => replace(materials.map((material) => material.id === id ? { ...material, ...patch, ...(patch.autoFocus === undefined ? { autoFocus: false } : {}) } : material))
  const removeMaterial = (id) => replace(materials.filter((material) => material.id !== id))
  const copyMaterial = (index) => {
    if (materials.length >= maxItems) return
    const source = materials[index]
    const name = `${source.name || '材料'}（副本）`.slice(0, 40)
    const copy = { ...createCollectionMaterial(name, { required: source.required, namingPattern: source.namingPattern }), autoFocus: true }
    const next = [...materials]
    next.splice(index + 1, 0, copy)
    setFocusId(copy.id)
    replace(next)
  }
  const moveMaterial = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const next = [...materials]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    replace(next)
  }
  const applyBulk = () => {
    const names = parseBulkMaterials(bulkText)
    if (!names.length) return
    const existing = new Set(materials.map((material) => material.name.trim()).filter(Boolean))
    const fresh = names.filter((name) => !existing.has(name)).slice(0, Math.max(0, maxItems - materials.length))
    if (!fresh.length) { setBulkOpen(false); setBulkText(''); return }
    const added = fresh.map((name, index) => ({ ...createCollectionMaterial(name, { required: true }), autoFocus: index === 0 }))
    setFocusId(added[0].id)
    replace([...materials, ...added])
    setBulkOpen(false)
    setBulkText('')
  }

  return (
    <section className={`collection-builder-section collection-material-editor ${materials.length ? 'has-items' : ''} ${compact ? 'is-compact' : ''}`} aria-labelledby={headingId}>
      <div className="collection-builder-section-heading">
        <div>
          <strong id={headingId}>材料清单</strong>
          <small>{materials.length ? `${materials.length} 项 · ${requiredCount} 项必交 · 至少选 1 项` : '列出需要提交的材料，可设必交和命名规则'}</small>
        </div>
        <div className="collection-builder-section-actions">
          {materials.length > 0 && <button type="button" className="secondary-button collection-ghost-action" onClick={() => setBulkOpen((open) => !open)}>批量添加</button>}
          <button type="button" className="secondary-button" disabled={materials.length >= maxItems} onClick={() => addMaterial()}><Plus size={14} /><span>添加材料</span></button>
        </div>
      </div>
      {bulkOpen && (
        <div className="collection-bulk-add">
          <textarea aria-label="批量添加材料" value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={3} placeholder={'每行一个材料名称，例如：\n营业执照\n身份证正反面\n合同文件'} />
          <div className="collection-bulk-actions">
            <small>支持换行、逗号或分号分隔，重复项会自动跳过</small>
            <button type="button" className="secondary-button" onClick={() => setBulkOpen(false)}>取消</button>
            <button type="button" className="primary-button" disabled={!bulkText.trim()} onClick={applyBulk}>添加到清单</button>
          </div>
        </div>
      )}
      {!materials.length ? (
        <div className="collection-builder-empty collection-empty-state">
          <p>当前允许提交人上传任意文件。</p>
          {showTemplates && <CollectionPresetDisclosure label="常用材料" count={COLLECTION_MATERIAL_TEMPLATES.slice(0, 8).length}>
            {COLLECTION_MATERIAL_TEMPLATES.slice(0, 8).map((name) => <button key={name} type="button" onClick={() => addMaterial(name)}><Plus size={12} />{name}</button>)}
          </CollectionPresetDisclosure>}
        </div>
      ) : (
        <>
          {visibleMaterials.map((material) => {
            const index = materials.findIndex((item) => item.id === material.id)
            return (
              <MaterialRow
                key={material.id}
                material={material}
                index={index}
                total={materials.length}
                error={errors[material.id]}
                onUpdate={(patch) => updateMaterial(material.id, patch)}
                onRemove={() => removeMaterial(material.id)}
                onCopy={() => copyMaterial(index)}
                onMove={moveMaterial}
                dragId={dragId}
                setDragId={setDragId}
              />
            )
          })}
          {materials.length > 3 && <button type="button" className="collection-expand-toggle" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? '收起材料' : `展开其余 ${materials.length - 3} 项`}
          </button>}
        </>
      )}
      {materials.length >= maxItems && <p className="collection-field-limit-note">已达到 {maxItems} 项上限，删除后可继续添加。</p>}
    </section>
  )
}

function FieldOptionsEditor({ field, index, onUpdate }) {
  const [text, setText] = useState((field.options || []).join('，'))
  const signature = (field.options || []).join('|')
  useEffect(() => {
    setText((current) => normalizeCollectionFieldOptions(current).join('|') === signature ? current : (field.options || []).join('，'))
  }, [signature])
  const options = field.options || []
  return (
    <div className="collection-field-options-editor">
      <label className="collection-field-option-input">
        <span>下拉选项</span>
        <input
          className="collection-field-options"
          aria-label={`${field.label || `字段 ${index + 1}`}下拉选项`}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            onUpdate({ options: normalizeCollectionFieldOptions(event.target.value) })
          }}
          placeholder="用逗号分隔，例如：生产商，经销商"
        />
      </label>
      {options.length > 0 && <div className="collection-option-chips">
        {options.map((option) => <span key={option} className="collection-option-chip">{option}<button type="button" aria-label={`删除选项 ${option}`} onClick={() => onUpdate({ options: options.filter((item) => item !== option) })}>×</button></span>)}
      </div>}
    </div>
  )
}

function FieldConditionEditor({ field, index, allFields, onUpdate }) {
  const candidates = allFields.filter((item) => item.id !== field.id && item.type === 'select' && (item.options || []).length > 0)
  if (!candidates.length) return null
  const value = field.showWhen?.fieldId ? `${field.showWhen.fieldId}::${field.showWhen.value}` : ''
  return (
    <label className="collection-field-condition">
      <span>显示条件（可选）</span>
      <select
        aria-label={`${field.label || `字段 ${index + 1}`}显示条件`}
        value={value}
        onChange={(event) => {
          const raw = event.target.value
          if (!raw) { onUpdate({ showWhen: undefined }); return }
          const divider = raw.indexOf('::')
          onUpdate({ showWhen: { fieldId: raw.slice(0, divider), value: raw.slice(divider + 2) } })
        }}
      >
        <option value="">始终显示</option>
        {candidates.map((controller) => (
          <optgroup key={controller.id} label={`当「${controller.label || '未命名字段'}」选择`}>
            {(controller.options || []).map((option) => <option key={option} value={`${controller.id}::${option}`}>{option}</option>)}
          </optgroup>
        ))}
      </select>
      {field.showWhen?.fieldId && <small>仅当对应字段选择「{field.showWhen.value}」时显示和校验。</small>}
    </label>
  )
}

function FieldRow({
  field, index, total, error, allFields, onUpdate, onRemove, onCopy, onMove,
}) {
  const move = (direction) => {
    const next = Math.max(0, Math.min(total - 1, index + direction))
    if (next !== index) onMove(index, next)
  }
  return (
    <div className="collection-field-editor">
      <div className="collection-field-editor-main">
        <label className="collection-field-name">
          <span className="collection-inline-label">
            <span>字段名称</span>
            <small className={field.label.length >= 40 ? 'field-count at-limit' : 'field-count'}>{field.label.length}/40</small>
          </span>
          <input
            aria-label={`字段名称 ${index + 1}`}
            value={field.label}
            maxLength={40}
            autoFocus={field.autoFocus}
            onChange={(event) => onUpdate({ label: event.target.value })}
            placeholder="字段名称，例如：供应商类型"
          />
        </label>
        <select aria-label={`字段类型 ${index + 1}`} value={field.type} onChange={(event) => {
          const type = event.target.value
          onUpdate({ type, ...(type === 'select' ? { options: field.options?.length >= 2 ? field.options : ['选项一', '选项二'] } : {}) })
        }}>
          {COLLECTION_FIELD_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="collection-rule-required">
          <input type="checkbox" checked={field.required} onChange={(event) => onUpdate({ required: event.target.checked })} />
          必填
        </label>
        <div className="collection-field-actions">
          <button type="button" className="ghost-icon" disabled={index === 0} aria-label={`上移字段 ${index + 1}`} title="上移" onClick={() => move(-1)}><ArrowUp size={14} /></button>
          <button type="button" className="ghost-icon" disabled={index === total - 1} aria-label={`下移字段 ${index + 1}`} title="下移" onClick={() => move(1)}><ArrowDown size={14} /></button>
          <button type="button" className="ghost-icon" aria-label={`复制字段 ${index + 1}`} title="复制" onClick={onCopy}><Copy size={14} /></button>
          <button type="button" className="ghost-icon collection-field-delete" aria-label={`删除字段 ${index + 1}`} title="删除字段" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
      {error?.label && <small className="collection-inline-error" role="alert">{error.label}</small>}
      <label className="collection-field-help-input">
        <span>填写提示（可选）</span>
        <input
          aria-label={`${field.label || `字段 ${index + 1}`}填写提示`}
          value={field.help || ''}
          maxLength={120}
          onChange={(event) => onUpdate({ help: event.target.value })}
          placeholder="例如：请填写可以联系到你的手机号"
        />
      </label>
      {error?.help && <small className="collection-inline-error" role="alert">{error.help}</small>}
      {field.type === 'select' && <>
        <FieldOptionsEditor field={field} index={index} onUpdate={onUpdate} />
        {error?.options && <small className="collection-inline-error" role="alert">{error.options}</small>}
      </>}
      <FieldConditionEditor field={field} index={index} allFields={allFields} onUpdate={onUpdate} />
      {error?.showWhen && <small className="collection-inline-error" role="alert">{error.showWhen}</small>}
    </div>
  )
}

export function CollectionFieldsEditor({
  customFields = [], onChange, errors = {}, compact = false, headingId = 'collection-fields-heading',
  maxItems = COLLECTION_FIELD_LIMIT, showTemplates = true,
}) {
  const [expanded, setExpanded] = useState(false)
  const [focusId, setFocusId] = useState('')
  const requiredCount = customFields.filter((field) => field.required).length
  const visibleFields = expanded ? customFields : customFields.slice(0, 3)

  useEffect(() => {
    if (focusId && customFields.findIndex((field) => field.id === focusId) >= 3) setExpanded(true)
  }, [focusId, customFields])

  const replace = (next) => onChange(next)
  const addField = (template = {}) => {
    if (customFields.length >= maxItems) return
    const field = createCollectionField(template.label || '', {
      type: template.type || 'text',
      required: template.required ?? false,
      options: template.options,
      help: template.help,
    })
    field.autoFocus = true
    setFocusId(field.id)
    replace([...customFields, field])
  }
  const updateField = (id, patch) => replace(customFields.map((field) => field.id === id ? { ...field, ...patch, ...(patch.autoFocus === undefined ? { autoFocus: false } : {}) } : field))
  const removeField = (id) => replace(customFields.filter((field) => field.id !== id))
  const copyField = (index) => {
    if (customFields.length >= maxItems) return
    const source = customFields[index]
    const copy = { ...createCollectionField(`${source.label || '字段'}（副本）`.slice(0, 40), source), showWhen: undefined, autoFocus: true }
    const next = [...customFields]
    next.splice(index + 1, 0, copy)
    setFocusId(copy.id)
    replace(next)
  }
  const moveField = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const next = [...customFields]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    replace(next)
  }
  return (
    <section className={`collection-builder-section collection-field-editor-section ${customFields.length ? 'has-items' : ''} ${compact ? 'is-compact' : ''}`} aria-labelledby={headingId}>
      <div className="collection-builder-section-heading">
        <div>
          <strong id={headingId}>自定义字段</strong>
          <small>{customFields.length ? `${customFields.length} 项 · ${requiredCount} 项必填` : '按需收集联系人、电话等补充信息'}</small>
        </div>
        <div className="collection-builder-section-actions">
          <button type="button" className="secondary-button" disabled={customFields.length >= maxItems} onClick={() => addField()}><Plus size={14} /><span>添加字段</span></button>
        </div>
      </div>
      {!customFields.length ? (
        <div className="collection-builder-empty collection-empty-state">
          <p>不添加字段时，提交人只需上传文件。</p>
          {showTemplates && <CollectionPresetDisclosure label="常用字段" count={COLLECTION_FIELD_TEMPLATES.length}>
            {COLLECTION_FIELD_TEMPLATES.map((template) => <button key={template.label} type="button" onClick={() => addField(template)}><Plus size={12} />{template.label}</button>)}
          </CollectionPresetDisclosure>}
        </div>
      ) : (
        <>
          {visibleFields.map((field) => {
            const index = customFields.findIndex((item) => item.id === field.id)
            return (
              <FieldRow
                key={field.id}
                field={field}
                index={index}
                total={customFields.length}
                error={errors[field.id]}
                allFields={customFields}
                onUpdate={(patch) => updateField(field.id, patch)}
                onRemove={() => removeField(field.id)}
                onCopy={() => copyField(index)}
                onMove={moveField}
              />
            )
          })}
          {customFields.length > 3 && <button type="button" className="collection-expand-toggle" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? '收起字段' : `展开其余 ${customFields.length - 3} 个`}
          </button>}
        </>
      )}
      {customFields.length >= maxItems && <p className="collection-field-limit-note">已达到 {maxItems} 个上限，删除后可继续添加。</p>}
    </section>
  )
}

export function CollectionStructureAssistant({ form, onApplyStructure, copySources = [], onCopyStructure }) {
  const [scenarioId, setScenarioId] = useState('')
  const [saved, setSaved] = useState(() => readSavedCollectionStructures())
  const [savedId, setSavedId] = useState('')
  const [copyId, setCopyId] = useState('')
  const [saveName, setSaveName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const describeResult = (result) => {
    if (!result?.addedMaterials && !result?.addedFields) return '没有新增内容，当前结构已经包含这些材料或字段。'
    return `已添加 ${result.addedMaterials || 0} 项材料、${result.addedFields || 0} 个字段${(result.skippedMaterials || result.skippedFields) ? '，重复项已跳过' : ''}。`
  }
  const apply = (structure) => {
    const result = onApplyStructure(structure)
    setMessage(describeResult(result))
    return result
  }
  const applyScenario = () => {
    const scenario = COLLECTION_SCENARIOS.find((item) => item.id === scenarioId)
    if (!scenario) return
    apply({ materials: scenario.materials, customFields: scenario.customFields })
  }
  const smartGenerate = () => {
    const structure = generateCollectionStructure({ title: form.title, description: form.description })
    apply(structure)
  }
  const saveCurrent = () => {
    const savedStructure = saveCollectionStructure(saveName || form.title, form)
    if (!savedStructure) { setMessage('当前浏览器无法保存结构，请检查本地存储权限。'); return }
    setSaved(readSavedCollectionStructures())
    setSaveName('')
    setMessage(`已保存「${savedStructure.name}」，下次可直接套用。`)
  }
  const applySaved = () => {
    const structure = saved.find((item) => item.id === savedId)
    if (structure) apply(structure)
  }
  const deleteSaved = () => {
    if (!savedId) return
    setSaved(deleteSavedCollectionStructure(savedId))
    setSavedId('')
    setMessage('已删除这套常用结构。')
  }
  const copyExisting = async () => {
    if (!copyId || !onCopyStructure) return
    setBusy(true)
    setMessage('')
    try {
      const structure = await onCopyStructure(copyId)
      apply(structure)
    } catch (error) {
      setMessage(error?.message || '读取已有任务结构失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="collection-structure-assistant">
      <summary>
        <span className="collection-assistant-icon"><Sparkles size={16} /></span>
        <span><strong>快速搭建</strong><small>场景模板、智能推荐、复制已有任务结构</small></span>
        <ChevronDown className="collection-assistant-chevron" size={15} />
      </summary>
      <div className="collection-structure-assistant-body">
        <div className="collection-assistant-row">
          <label className="collection-assistant-field">
            <span><Layers size={13} />常用场景</span>
            <select aria-label="选择常用场景" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
              <option value="">选择一个场景开始</option>
              {COLLECTION_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name} · {scenario.hint}</option>)}
            </select>
          </label>
          <button type="button" className="secondary-button" disabled={!scenarioId} onClick={applyScenario}>套用场景</button>
          <button type="button" className="primary-button" onClick={smartGenerate}><Wand2 size={14} /> 根据说明智能推荐</button>
        </div>
        <p className="collection-assistant-tip">智能推荐会读取上面的任务名称和收集说明，自动补充材料与字段；结果可以继续手动修改。</p>
        {copySources.length > 0 && <div className="collection-assistant-row">
          <label className="collection-assistant-field">
            <span><FolderOpen size={13} />复制已有任务</span>
            <select aria-label="选择已有收集任务" value={copyId} onChange={(event) => setCopyId(event.target.value)}>
              <option value="">选择我的收集任务</option>
              {copySources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
          <button type="button" className="secondary-button" disabled={!copyId || busy} onClick={copyExisting}>{busy ? '读取中…' : '复制任务结构'}</button>
        </div>}
        <div className="collection-assistant-row collection-assistant-save">
          <label className="collection-assistant-field">
            <span><Bookmark size={13} />常用结构</span>
            <input aria-label="结构名称" value={saveName} maxLength={40} onChange={(event) => setSaveName(event.target.value)} placeholder="给当前结构起个名字（可选）" />
          </label>
          <button type="button" className="secondary-button" onClick={saveCurrent}>存为常用结构</button>
          {saved.length > 0 && <>
            <select aria-label="选择已保存结构" value={savedId} onChange={(event) => setSavedId(event.target.value)}>
              <option value="">已保存结构</option>
              {saved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={!savedId} onClick={applySaved}>套用</button>
            <button type="button" className="ghost-icon" disabled={!savedId} aria-label="删除已保存结构" title="删除已保存结构" onClick={deleteSaved}><Trash2 size={15} /></button>
          </>}
        </div>
        {message && <p className="collection-assistant-message" role="status">{message}</p>}
      </div>
    </details>
  )
}

function PreviewControl({ field }) {
  if (field.type === 'select') {
    return <select disabled><option value="">{`请选择${field.label}`}</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select>
  }
  if (field.type === 'textarea') return <textarea disabled rows={2} placeholder={`请填写${field.label}`} />
  return <input type={collectionFieldInputType(field.type)} disabled placeholder={field.type === 'date' ? '' : `请填写${field.label}`} />
}

export function CollectionSubmitPreview({ form }) {
  const materials = Array.isArray(form.materials) ? form.materials : []
  const customFields = Array.isArray(form.customFields) ? form.customFields : []
  const sampleValues = Object.fromEntries(customFields.filter((field) => field.type === 'select' && field.options?.length).map((field) => [field.id, field.options[0]]))
  const previewFields = visibleCollectionFields(customFields, sampleValues).slice(0, 5)
  const firstNaming = materials.find((material) => material.namingPattern)
  const requiredCount = customFields.filter((field) => field.required).length
  return (
    <div className="preview-card collection-preview-card collection-submit-preview">
      <div className="collection-preview-title"><span className="preview-icon"><PrototypeAsset name="act-clipboard.png" width={20} height={20} /></span><strong>{form.title || '未命名任务'}</strong></div>
      <span className="collection-preview-description">{form.description || '请填写收集说明'}</span>
      <div className="collection-preview-limits">
        <span>{formatAllowedTypes(form.allowedTypes)}</span>
        <span>单文件 ≤ {formatBytes((Number(form.maxFileSizeMb) || 500) * 1024 ** 2)}</span>
        <span>截止 {form.deadline || '未设置'}</span>
      </div>
      <div className="collection-preview-submit-section">
        <div className="collection-preview-section-heading"><strong>提交材料</strong><small>{materials.length ? `${materials.length} 项 · ${materials.filter((material) => material.required).length} 项必交` : '不限材料'}</small></div>
        {materials.length ? <div className="collection-preview-material-list">
          {materials.slice(0, 4).map((material, index) => <label key={material.id} className="collection-preview-material-item">
            <input type="checkbox" disabled checked={material.required || index === 0} readOnly />
            <span>{material.name || '未命名材料'}{material.required ? <em>必交</em> : <small>选交</small>}</span>
          </label>)}
          {materials.length > 4 && <small className="collection-preview-more">还有 {materials.length - 4} 项材料</small>}
        </div> : <p className="collection-preview-empty">提交人可以直接上传任意文件。</p>}
        {firstNaming && <small className="collection-preview-naming">自动命名示例：<code>{namingExample(firstNaming) || '示例文件.pdf'}</code></small>}
      </div>
      {(customFields.length > 0 || requiredCount > 0) && <div className="collection-preview-submit-section">
        <div className="collection-preview-section-heading"><strong>补充信息</strong><small>{customFields.length} 个字段 · {requiredCount} 个必填</small></div>
        <div className="collection-preview-field-list">
          {previewFields.map((field) => <label key={field.id} className="collection-preview-field">
            <span>{field.label || '未命名字段'}{field.required ? <em>必填</em> : <small>选填</small>}{field.showWhen?.fieldId && <small className="conditional">条件显示</small>}</span>
            <PreviewControl field={field} />
            {field.help && <small className="collection-preview-field-help">{field.help}</small>}
          </label>)}
          {customFields.length > 5 && <small className="collection-preview-more">还有 {customFields.length - 5} 个字段</small>}
        </div>
      </div>}
      <div className="collection-preview-drop"><PrototypeAsset name="ico-cloud.png" width={26} height={22} /><span>拖拽文件到这里，或点击选择</span></div>
      <div className="collection-preview-submit-row"><small>提交人名称</small><span>张三（示例）</span></div>
      <small className="collection-preview-footer">提交者之间互不可见，创建者可查看全部文件</small>
    </div>
  )
}
