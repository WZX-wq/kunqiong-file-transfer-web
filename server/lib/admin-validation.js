import { ACCOUNT_PLANS } from '../config.js'
import { dateInput } from './input-validation.js'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const bounds = { defaultShareDays: [1,365], maxShareDays: [1,365], anonymousMaxFileSizeMb: [1,20480], anonymousCollectionParticipantLimit: [0,10000], anonymousActiveCollectionLimit: [0,1000], anonymousTotalSizeMb: [0,102400], maxBatchFiles: [1,100], auditLogRetentionDays: [1,3650], orphanGraceHours: [1,720] }
function numeric(value,min,max,integer=true) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') return false
  const n=Number(value)
  return Number.isFinite(n) && n>=min && n<=max && (!integer || Number.isInteger(n))
}
const wholeGigabyteBytes = (value, min, max) => numeric(value, min * 1024 ** 3, max * 1024 ** 3) && Number(value) % 1024 ** 3 === 0

// Validate writes separately from tolerant normalization of old disk metadata.
export function systemConfigError(body, current) {
  if (!object(body)) return '系统配置格式不正确'
  for (const [key,value] of Object.entries(body)) {
    if (key==='maintenanceMode') { if (typeof value!=='boolean') return '维护模式必须为布尔值' }
    else if (Object.hasOwn(bounds,key)) { if (!numeric(value,...bounds[key],key!=='anonymousMaxFileSizeMb')) return `配置项 ${key} 超出允许范围` }
    else if (key==='planOverrides') {
      if (!object(value)) return '套餐配置格式不正确'
      for (const [id,plan] of Object.entries(value)) {
        if (!Object.hasOwn(ACCOUNT_PLANS,id) || !object(plan)) return '套餐配置不支持'
        if (ACCOUNT_PLANS[id].retired) return '该套餐已下架，不能修改配置'
        for (const [field,v] of Object.entries(plan)) {
          if (field==='totalGb' || field==='totalGB') { if (!numeric(v,1,20480)) return '个人容量须为 1 至 20480 GB 的整数' }
          else if (field==='totalBytes') { if (!wholeGigabyteBytes(v,1,20480)) return '个人容量须为 1 至 20480 GB 的整数' }
          else if (field==='teamGb') { if (!numeric(v,0,20480)) return '团队容量须为 0 至 20480 GB 的整数' }
          else if (field==='teamSpaceBytes') { if (!wholeGigabyteBytes(v,0,20480)) return '团队容量须为 0 至 20480 GB 的整数' }
          else if (field==='singleFileGb') { if (!numeric(v,1,20)) return '单文件上限须为 1 至 20 GB 的整数' }
          else if (field==='singleFileLimitBytes') { if (!wholeGigabyteBytes(v,1,20)) return '单文件上限须为 1 至 20 GB 的整数' }
          else if (field==='collectionParticipantLimit') { if (!numeric(v,0,10000)) return '收集人数上限无效' }
          else if (field==='activeCollectionLimit') { if (!numeric(v,0,1000)) return '进行中收集任务数上限无效' }
          else if (field==='monthlyPrice') return '购买价格由会员主站统一管理，请在主站修改'
          else if (field==='validityDays') { if (v!==null && !numeric(v,0,3650)) return '套餐有效期无效'; if (id==='free' && v!==null && Number(v)!==0) return '基础版无需配置会员有效期' }
          else return '未知套餐配置项'
        }
      }
    } else return '未知系统配置项'
  }
  if (Number(body.defaultShareDays ?? current.defaultShareDays)>Number(body.maxShareDays ?? current.maxShareDays)) return '默认保存天数不能超过最大保存天数'
  const guestFile = Number(body.anonymousMaxFileSizeMb ?? current.anonymousMaxFileSizeMb)
  const guestTotal = Number(body.anonymousTotalSizeMb ?? current.anonymousTotalSizeMb)
  if (Object.hasOwn(body, 'anonymousMaxFileSizeMb') || Object.hasOwn(body, 'anonymousTotalSizeMb')) {
    if (guestTotal > 0 && guestTotal < guestFile) return '未登录累计额度不能小于单文件上限'
  }
  return ''
}

export function userUpdateError(body) {
  if (!object(body)) return '用户修改格式不正确'
  if (!Object.keys(body).length) return '请提供需要修改的内容'
  if (Object.keys(body).some(key=>!['planId','planExpiresAt','status'].includes(key))) return '未知用户配置项'
  if (Object.hasOwn(body,'planId') && (typeof body.planId !== 'string' || !Object.hasOwn(ACCOUNT_PLANS,body.planId))) return '套餐不支持'
  if (Object.hasOwn(body,'planId') && ACCOUNT_PLANS[body.planId].retired) return '该套餐已下架，不能新增授予'
  if (Object.hasOwn(body,'status') && !['active','disabled'].includes(body.status)) return '用户状态不支持'
  if (Object.hasOwn(body,'planExpiresAt') && body.planExpiresAt!==null && (typeof body.planExpiresAt!=='string' || !body.planExpiresAt.trim() || !Number.isFinite(Date.parse(body.planExpiresAt)))) return '套餐有效期不正确'
  if (body.planExpiresAt !== undefined && body.planExpiresAt !== null) { try { dateInput(body.planExpiresAt,'套餐有效期') } catch { return '套餐有效期不正确或超出允许范围' } }
  return ''
}
