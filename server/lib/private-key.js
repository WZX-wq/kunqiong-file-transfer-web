import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { storageRoot } from '../config.js'
import { durableWrite, removeFile, withFileLock } from './file-lock.js'

let key
export function requireSharedDataKey() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.KUNQIONG_DATA_KEY || '')) {
    throw new Error('数据库模式需要配置有效的 KUNQIONG_DATA_KEY（32 字节十六进制共享密钥），已停止启动以避免明文保存凭据')
  }
}

export function privateKey(create = true) {
  if (key) return key
  const configured = process.env.KUNQIONG_DATA_KEY
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error('KUNQIONG_DATA_KEY 必须为 32 字节十六进制密钥')
    return (key = Buffer.from(configured, 'hex'))
  }
  // Kept separately from metadata/backups, with restrictive permissions. Existing
  // encrypted data fails closed if this key is lost; never silently regenerate it.
  const filename = path.join(storageRoot, '.private-key')
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(filename)) {
    if (!create) throw new Error('数据保护密钥缺失，已停止读取加密数据')
    withFileLock(`${filename}.lock`, () => {
      if (fs.existsSync(filename)) return
      const candidate = `${filename}.${crypto.randomUUID()}.tmp`
      try {
        durableWrite(candidate, crypto.randomBytes(32))
        fs.renameSync(candidate, filename)
      } finally { removeFile(candidate) }
    })
  }
  const loaded = fs.readFileSync(filename)
  if (loaded.length !== 32) throw new Error('数据保护密钥损坏，已停止操作')
  fs.chmodSync(filename, 0o600)
  return (key = loaded)
}

export function keyedDigest(value) {
  return crypto.createHmac('sha256', privateKey()).update(String(value)).digest('hex')
}

export function protectCredential(value, context) {
  if (!value) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', privateKey(), iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

export function revealCredential(value, context) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value
  if (!value.startsWith('enc:v1:')) throw new Error('凭据加密版本不受支持')
  const data = Buffer.from(value.slice(7), 'base64')
  if (data.length < 29) throw new Error('加密凭据损坏')
  const cipher = crypto.createDecipheriv('aes-256-gcm', privateKey(false), data.subarray(0,12))
  cipher.setAAD(Buffer.from(context))
  cipher.setAuthTag(data.subarray(12,28))
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
}

export function transformCredentials(snapshot, encode = false) {
  const transform = encode ? protectCredential : revealCredential
  return { ...snapshot,
    sessions: (snapshot.sessions || []).map(session => ({ ...session, apiWebToken:transform(session.apiWebToken, `session:${session.id}`) })),
    upgradeOrders: (snapshot.upgradeOrders || []).map(order => ({ ...order, ...(order.paymentQueryCredential ? { paymentQueryCredential:{ ...order.paymentQueryCredential, apiWebToken:transform(order.paymentQueryCredential.apiWebToken, `order:${order.id}`) } } : {}) })),
  }
}
