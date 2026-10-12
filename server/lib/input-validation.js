// Validate new writes before mutation; historical metadata normalizers remain tolerant.
import { httpError } from './http.js'
import { MAX_ACCOUNT_RECORDS, MAX_RECORD_FILES, MAX_RECORD_SUBMISSIONS, ACCOUNT_RECORD_SCOPES, ACCOUNT_RECORD_KINDS } from '../config.js'

export const INVALID_TEXT = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u
export function objectInput(value, allowed, { nonempty = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, '输入格式必须为对象')
  const keys = Object.keys(value)
  if (allowed && keys.some(key => !allowed.includes(key))) throw httpError(400, '包含不支持的输入字段')
  if (nonempty && !keys.length) throw httpError(400, '请提供需要修改的内容')
  return value
}
export function textInput(value, label, max, { optional = false, multiline = false, trim = true } = {}) {
  if (typeof value !== 'string') throw httpError(400, `${label}必须为文本`)
  const checked = multiline ? value.replace(/[\r\n\t]/g, '') : value
  if (INVALID_TEXT.test(checked) || !value.isWellFormed()) throw httpError(400, `${label}不能包含控制字符或无效字符`)
  const text = trim ? value.trim() : value
  if ((!optional && !text) || text.length > max) throw httpError(400, `${label}${!text ? '不能为空' : `不能超过 ${max} 个字符`}`)
  return text
}
export function integerInput(value, label, min, max, { string = true } = {}) {
  if (typeof value !== 'number' && !(string && typeof value === 'string' && /^\d+$/.test(value))) throw httpError(400, `${label}必须为有效整数`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) throw httpError(400, `${label}须在 ${min}–${max} 范围内`)
  return number
}
export function booleanInput(value, label) {
  if (typeof value !== 'boolean') throw httpError(400, `${label}必须为布尔值`)
  return value
}
export function dateInput(value, label, { max = Date.now() + 3650 * 86400000 } = {}) {
  if (typeof value !== 'string') throw httpError(400, `${label}格式不正确`)
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/)
  if (!match) throw httpError(400, `${label}格式不正确`)
  const [,y,m,d,h='0',minute='0',second='0',zone=''] = match
  const calendar = new Date(Date.UTC(+y,+m-1,+d))
  if (+y < 1000 || calendar.getUTCFullYear() !== +y || calendar.getUTCMonth() !== +m-1 || calendar.getUTCDate() !== +d
    || +h > 23 || +minute > 59 || +second > 59 || (zone && zone !== 'Z' && (+zone.slice(1,3) > 23 || +zone.slice(4) > 59))) throw httpError(400, `${label}不是有效日期`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > max) throw httpError(400, `${label}超出允许范围`)
  return parsed.toISOString()
}
export function booleanSettings(value, allowed, current) {
  objectInput(value, allowed, { nonempty: true })
  const result = { ...current }
  for (const [key, flag] of Object.entries(value)) result[key] = booleanInput(flag, key)
  return result
}
export function recordInputs(records, maxRecords = MAX_ACCOUNT_RECORDS) {
  if (!Array.isArray(records) || records.length > maxRecords) throw httpError(400, `记录须为最多 ${maxRecords} 条的列表`)
  const limits = { id:180,alias:80,name:160,type:20,scope:40,kind:40,meta:240,code:40,status:40,shareId:80,shareUrl:400,manageToken:120,manageUrl:400,collectionToken:120,publicUrl:400,participantName:80,submitterUserId:120,submitterName:80 }
  const numbers = ['downloadLimit','downloadCount','fileCount','totalSize','submissionCount','maxFileSizeMb']
  const dates = ['createdAt','updatedAt','expiresAt','deadline','submittedAt','lastSeenAt']
  for (const record of records) {
    objectInput(record)
    textInput(record.id, '记录 ID', 180)
    for (const [key,max] of Object.entries(limits)) if (Object.hasOwn(record,key) && record[key] !== null) textInput(record[key],key,max,{optional:key!=='id',multiline:key==='meta'})
    for (const key of numbers) if (Object.hasOwn(record,key) && record[key] !== null) integerInput(record[key],key,0,Number.MAX_SAFE_INTEGER,{string:false})
    for (const key of dates) if (record[key] !== undefined && record[key] !== null && record[key] !== '') dateInput(record[key],key)
    for (const [key, choices] of [['scope', ACCOUNT_RECORD_SCOPES], ['kind', ACCOUNT_RECORD_KINDS]]) if (record[key] && !choices.has(record[key])) throw httpError(400, `${key}不支持`)
    for (const key of ['files','submissions','allowedTypes']) if (Object.hasOwn(record,key) && !Array.isArray(record[key])) throw httpError(400, `${key}须为列表`)
    if (record.allowedTypes) {
      if (record.allowedTypes.length > 12) throw httpError(400, '文件类型最多 12 项')
      record.allowedTypes.forEach(value => textInput(value, '文件类型', 20))
    }
    recordFileInputs(record.files)
    if (record.submissions) {
      if (record.submissions.length > MAX_RECORD_SUBMISSIONS) throw httpError(400, `提交记录最多 ${MAX_RECORD_SUBMISSIONS} 条`)
      for (const submission of record.submissions) {
        objectInput(submission)
        for (const [key, max] of [['id',120],['participantName',80],['submitterUserId',120],['submitterName',80]]) if (submission[key] !== undefined) textInput(submission[key],key,max,{optional:true})
        if (submission.submittedAt) dateInput(submission.submittedAt,'提交时间')
        recordFileInputs(submission.files)
      }
    }
  }
  return records
}
function recordFileInputs(files) {
  if (files === undefined) return
  if (!Array.isArray(files) || files.length > MAX_RECORD_FILES) throw httpError(400, `记录文件须为最多 ${MAX_RECORD_FILES} 项的列表`)
  for (const file of files) {
      objectInput(file)
      if (file.size !== undefined) integerInput(file.size,'文件大小',0,Number.MAX_SAFE_INTEGER,{string:false})
      for (const [key,max] of [['name',240],['relativePath',1024],['mimeType',100]]) if (file[key] !== undefined) textInput(file[key],key,max,{optional:true})
  }
}
