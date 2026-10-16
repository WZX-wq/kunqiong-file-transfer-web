import { ACCOUNT_PLANS } from '../config.js'
import { dateInput } from './input-validation.js'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const bounds = { defaultShareDays: [1,365], maxShareDays: [1,365], anonymousMaxFileSizeMb: [1,5120], anonymousTotalSizeMb: [0,102400], maxBatchFiles: [1,100], auditLogRetentionDays: [1,3650], orphanGraceHours: [1,720] }
function numeric(value,min,max,integer=true) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') return false
  const n=Number(value)
  return Number.isFinite(n) && n>=min && n<=max && (!integer || Number.isInteger(n))
}

// Validate writes separately from tolerant normalization of old disk metadata.
export function systemConfigError(body, current) {
  if (!object(body)) return '系统配置格式不正确'
  for (const [key,value] of Object.entries(body)) {
    if (key==='maintenanceMode') { if (typeof value!=='boolean') return '维护模式必须为布尔值' }
    else if (Object.hasOwn(bounds,key)) { if (!numeric(value,...bounds[key])) return `配置项 ${key} 超出允许范围` }
    else if (key==='planOverrides') {
      if (!object(value)) return '套餐配置格式不正确'
      for (const [id,plan] of Object.entries(value)) {
        if (!Object.hasOwn(ACCOUNT_PLANS,id) || !object(plan)) return '套餐配置不支持'
        for (const [field,v] of Object.entries(plan)) {
          if (field==='totalGb' || field==='totalGB') { if (!numeric(v,0.001,20480,false)) return '套餐容量无效' }
          else if (field==='totalBytes') { if (!numeric(v,1,20480*1024**3)) return '套餐容量无效' }
          else if (field==='monthlyPrice') return '购买价格由会员主站统一管理，请在主站修改'
          else if (field==='validityDays') { if (v!==null && !numeric(v,1,3650)) return '套餐有效期无效' }
          else return '未知套餐配置项'
        }
      }
    } else return '未知系统配置项'
  }
  if (Number(body.defaultShareDays ?? current.defaultShareDays)>Number(body.maxShareDays ?? current.maxShareDays)) return '默认保存天数不能超过最大保存天数'
  return ''
}

export function userUpdateError(body) {
  if (!object(body)) return '用户修改格式不正确'
  if (!Object.keys(body).length) return '请提供需要修改的内容'
  if (Object.keys(body).some(key=>!['planId','planExpiresAt','status'].includes(key))) return '未知用户配置项'
  if (Object.hasOwn(body,'planId') && (typeof body.planId !== 'string' || !Object.hasOwn(ACCOUNT_PLANS,body.planId))) return '套餐不支持'
  if (Object.hasOwn(body,'status') && !['active','disabled'].includes(body.status)) return '用户状态不支持'
  if (Object.hasOwn(body,'planExpiresAt') && body.planExpiresAt!==null && (typeof body.planExpiresAt!=='string' || !body.planExpiresAt.trim() || !Number.isFinite(Date.parse(body.planExpiresAt)))) return '套餐有效期不正确'
  if (body.planExpiresAt !== undefined && body.planExpiresAt !== null) { try { dateInput(body.planExpiresAt,'套餐有效期') } catch { return '套餐有效期不正确或超出允许范围' } }
  return ''
}
