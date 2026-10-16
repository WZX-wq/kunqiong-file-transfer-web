import { clientAddress } from './request-security.js'
// 审计日志相关的无状态工具（被入口中间件与 admin 域共用）
//
// 放 lib：入口中间件（sanitizeAuditPath / requestIp）与 admin 域都要用，
// lib 不得反向 import services，故下沉到这里。

import {
  hashSecret
} from '../lib/http.js'

export function requestIp(req) {
  const raw = clientAddress(req)
  return hashSecret(raw).slice(0, 16)
}

export function sanitizeAuditPath(value = '') {
  return String(value)
    .replace(/\/manage\/[^/]+/g, '/manage/[token]')
    .replace(/\/(shares|collections|upload-sessions)\/[^/]+/g, '/$1/[token]')
    .replace(/\/(share|collect)\/[^/]+/g, '/$1/[token]')
}
