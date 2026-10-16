// 上传相关的通用工具与 Express 中间件
//
// 放在 lib 而非 routes：multer 实例同时被「分享创建」「收集提交」两条路由线使用，
// 后续收集域拆分时也从这里 import，避免 routes 之间互相依赖。
//
// 文件名规范化（normalizeUploadFileName / looksLikeMojibake）从 services/account.js
// 迁到这里 —— 它被 account / shares / 本模块 + 入口共同使用，属于纯文本工具；
// 只有放 lib，各上层才能单向依赖它（lib 不得反向 import services）。

import { normalizeUploadFileName } from './file-name.js'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform, pipeline } from 'node:stream'
import { httpError } from './http.js'
import { fileNameInput, mimeInput } from './file-input.js'

import { MAX_FILES, MAX_FILE_SIZE, UPLOAD_CHUNK_MAX_BYTES, tempRoot } from '../config.js'
import { uploadDiskReservations, uploadIntakeReservations } from '../state.js'

const intake = uploadIntakeReservations
const pendingDiskBytes = () => [...intake.values(), ...uploadDiskReservations.values()].reduce((sum, bytes) => sum + bytes, 0)
const storage = {
  _handleFile(req, file, done) {
    const filename = crypto.randomBytes(24).toString('hex')
    const target = path.join(tempRoot, filename)
    let size = 0
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length
      req.intakeBytes = (req.intakeBytes || 0) + chunk.length
      if (req.intakeBytes > req.uploadMaxBytes || size > req.uploadFileMaxBytes) return callback(httpError(413, '本次上传超过可用容量，请减少文件或使用分片上传'))
      callback(null, chunk)
    } })
    pipeline(file.stream, counter, fs.createWriteStream(target, { flags:'wx', mode:0o600 }), error => {
      if (error) fs.unlink(target, () => done(error))
      else done(null, { destination:tempRoot, filename, path:target, size })
    })
  },
  _removeFile(_req, file, done) { fs.unlink(file.path, done) },
}
const directUpload = multer({ storage, limits: { files:MAX_FILES, fileSize:MAX_FILE_SIZE, fields:20, parts:MAX_FILES+20, fieldNameSize:100, fieldSize:128 * 1024 } })

// The domain preflight must run first. Reserve disk/concurrency before consuming
// bytes, and independently count actual streamed bytes (including chunked requests).
export const upload = { array(field, count) {
  const receive = directUpload.array(field, count)
  return (req, res, next) => {
    try {
      if (!Number.isSafeInteger(req.uploadMaxBytes) || req.uploadMaxBytes <= 0) throw httpError(413, '当前可用上传容量不足')
      if (intake.size >= 4) throw httpError(429, '当前上传繁忙，请稍后重试')
      const length = req.get('content-length')
      const declared = length === undefined ? req.uploadMaxBytes : Number(length)
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > req.uploadMaxBytes + 1024 ** 2) throw httpError(413, '本次上传超过可用容量')
      const reserved = Math.min(declared, req.uploadMaxBytes)
      const disk = fs.statfsSync(tempRoot)
      const pending = pendingDiskBytes()
      if (Number(disk.bavail) * Number(disk.bsize) < pending + reserved + 64 * 1024 ** 2) throw httpError(507, '临时存储空间不足，请稍后重试')
      intake.set(req, reserved)
      const release = () => intake.delete(req)
      res.once('finish', release)
      res.once('close', release)
      receive(req, res, error => { if (error) release(); next(error) })
    } catch (error) { next(error) }
  }
} }

export const chunkUpload = multer({ dest: tempRoot, limits: { files: 1, fileSize: UPLOAD_CHUNK_MAX_BYTES, fields: 8, parts: 9, fieldNameSize: 100 } })

// Multer's chunk middleware writes to tempRoot before the route can validate
// the chunk. Reserve a bounded amount of disk headroom first so concurrent
// chunk requests cannot fill the temporary volume before the target file is
// checked and moved into its session directory.
export function prepareChunkUpload(req, res, next) {
  try {
    if (intake.size >= 16) throw httpError(429, '当前上传繁忙，请稍后重试')
    const declared = Number(req.get('content-length'))
    const maxBody = UPLOAD_CHUNK_MAX_BYTES + 1024 ** 2
    const reserved = Number.isSafeInteger(declared) && declared >= 0
      ? Math.min(maxBody, declared)
      : maxBody
    if (Number.isSafeInteger(declared) && declared > maxBody) throw httpError(413, '分片请求过大，请重新上传')
    const disk = fs.statfsSync(tempRoot)
    const pending = pendingDiskBytes()
    if (Number(disk.bavail) * Number(disk.bsize) < pending + reserved + 64 * 1024 ** 2) throw httpError(507, '临时存储空间不足，请稍后重试')
    intake.set(req, reserved)
    const release = () => intake.delete(req)
    res.once('finish', release)
    res.once('close', release)
    next()
  } catch (error) { next(error) }
}

export function normalizeUploadedFileNames(req, res, next) {
  try {
    for (const file of req.files || []) {
      file.originalname = fileNameInput(normalizeUploadFileName(file.originalname, { trim: false }))
      file.mimetype = mimeInput(file.mimetype)
    }
    next()
  } catch (error) {
    for (const file of req.files || []) {
      try { fs.unlinkSync(file.path) } catch {}
    }
    next(error)
  }
}

export { normalizeUploadFileName, looksLikeMojibake } from './file-name.js'
