import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limitInputText } from '../src/lib/input-limits.js'
import { validateCollectionStructure, createCollectionField, COLLECTION_FIELD_TEMPLATES, COLLECTION_SCENARIOS, generateCollectionStructure } from '../src/lib/collection-form.js'
import { normalizeCollectionFieldOptions, collectionFieldValueError } from '../src/lib/collection-fields.js'
import { normalizeCollectionCustomFields, normalizeCollectionMaterials, validateCollectionSubmissionInput } from '../server/lib/collection-forms.js'
import { textInput } from '../server/lib/input-validation.js'

test('名称、说明、填写提示在边界内接受，超出边界拒绝', () => {
  for (const size of [39, 40]) {
    const name = '中'.repeat(size)
    assert.equal(normalizeCollectionMaterials([{ id: 'm', name }])[0].name, name)
    assert.equal(normalizeCollectionCustomFields([{ id: 'f', label: name, type: 'text' }])[0].label, name)
    assert.equal(validateCollectionStructure([{ id: 'm', name }], [{ id: 'f', label: name, type: 'text' }]).hasErrors, false)
  }
  assert.throws(() => normalizeCollectionMaterials([{ name: '中'.repeat(41) }]), /40/)
  assert.throws(() => normalizeCollectionCustomFields([{ label: '中'.repeat(41) }]), /40/)
  for (const size of [119, 120]) {
    const help = '1'.repeat(size)
    assert.equal(normalizeCollectionCustomFields([{ id: 'f', label: '姓名', help }])[0].help, help)
    assert.equal(validateCollectionStructure([], [{ id: 'f', label: '姓名', help }]).hasErrors, false)
  }
  assert.throws(() => normalizeCollectionCustomFields([{ label: '姓名', help: '1'.repeat(121) }]), /120/)
  assert.ok(validateCollectionStructure([], [{ id: 'f', label: '姓名', help: '1'.repeat(121) }]).fieldErrors.f.help)
  for (const [label, max] of [['任务名称', 40], ['收集说明', 120], ['提交人名称', 40]]) {
    assert.equal(textInput('中'.repeat(max), label, max).length, max)
    assert.throws(() => textInput('中'.repeat(max + 1), label, max), /不能超过/)
    assert.throws(() => textInput('   ', label, max), /不能为空/)
  }
})

test('粘贴限制不会保留半个 Unicode 字符', () => {
  assert.equal(limitInputText('中'.repeat(39) + '😀', 40), '中'.repeat(39))
  assert.equal(limitInputText('1'.repeat(1000), 120).length, 120)
})

test('下拉选项长度和数量在前后端校验一致，不静默丢弃第 31 项', () => {
  const check = options => validateCollectionStructure([], [{ id: 'f', label: '分类', type: 'select', options }])
  const valid = ['甲'.repeat(40), '乙']
  assert.equal(check(valid).hasErrors, false)
  assert.equal(normalizeCollectionCustomFields([{ label: '分类', type: 'select', options: valid }])[0].options.length, 2)
  for (const options of [['甲'.repeat(41), '乙'], Array.from({ length: 31 }, (_, i) => `选项${i}`), ['甲'], ['甲', '甲']]) {
    assert.ok(check(options).fieldErrors.f.options)
    assert.throws(() => normalizeCollectionCustomFields([{ label: '分类', type: 'select', options }]))
  }
  assert.equal(normalizeCollectionFieldOptions(Array.from({ length: 31 }, (_, i) => `选项${i}`).join(',')).length, 31)
})

test('提交页单行和多行文本的上限在客户端和接口保持一致', () => {
  for (const [type, max] of [['text', 100], ['textarea', 500]]) {
    const field = { id: 'f', label: '说明', type, required: true }
    const task = { customFields: [field], materials: [] }
    for (const size of [max - 1, max]) {
      const value = '1'.repeat(size)
      assert.equal(collectionFieldValueError(field, value), '')
      assert.equal(validateCollectionSubmissionInput(task, { f: value }, [], []).fieldValues.f, value)
    }
    assert.match(collectionFieldValueError(field, '1'.repeat(max + 1)), /不能超过/)
    assert.throws(() => validateCollectionSubmissionInput(task, { f: '1'.repeat(max + 1) }, [], []), /不能超过/)
    assert.throws(() => validateCollectionSubmissionInput(task, { f: '   ' }, [], []), /必填/)
  }
})

test('所有内置字段和推荐均不自动填入提示，手写提示保留', () => {
  for (const source of [...COLLECTION_FIELD_TEMPLATES, ...COLLECTION_SCENARIOS.flatMap(item => item.customFields), ...generateCollectionStructure({ title: '电话 邮箱 金额 日期 备注' }).customFields]) {
    assert.equal(createCollectionField(source.label, source).help ?? '', '')
  }
  assert.equal(createCollectionField('姓名', { help: '手写提示' }).help, '手写提示')
})
