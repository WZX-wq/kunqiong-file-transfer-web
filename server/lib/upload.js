// 上传相关的通用工具与 Express 中间件
//
// 放在 lib 而非 routes：multer 实例同时被「分享创建」「收集提交」两条路由线使用，
// 后续收集域拆分时也从这里 import，避免 routes 之间互相依赖。
//
// 文件名规范化（normalizeUploadFileName / looksLikeMojibake）从 services/account.js
// 迁到这里 —— 它被 account / shares / 本模块 + 入口共同使用，属于纯文本工具；
// 只有放 lib，各上层才能单向依赖它（lib 不得反向 import services）。

import multer from 'multer'
import fs from 'node:fs'
import { fileNameInput, mimeInput } from './file-input.js'

import { MAX_FILES, MAX_FILE_SIZE, UPLOAD_CHUNK_MAX_BYTES, tempRoot } from '../config.js'

export const upload = multer({
  dest: tempRoot,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE, fields: 20, parts: MAX_FILES + 20, fieldNameSize: 100 },
})

export const chunkUpload = multer({ dest: tempRoot, limits: { files: 1, fileSize: UPLOAD_CHUNK_MAX_BYTES, fields: 8, parts: 9, fieldNameSize: 100 } })

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

// 浏览器偶发把 UTF-8 文件名按 latin1 上报（表现为「ä½ å¥½.txt」这类乱码），
// 检出这种特征时按 latin1→utf8 还原；无法还原则原样返回。
export function normalizeUploadFileName(value = '', { trim = true } = {}) {
  const text = String(value || '')
  const raw = trim ? text.trim() : text
  if (!raw) return raw
  const decoded = Buffer.from(raw, 'latin1').toString('utf8')
  if (decoded && decoded !== raw && !decoded.includes('\uFFFD') && looksLikeMojibake(raw)) return decoded
  return raw
}

export function looksLikeMojibake(value = '') {
  return /(?:Ã|Â|Ä|Å|Æ|Ç|È|É|Ê|Ë|Ì|Í|Î|Ï|Ð|Ñ|Ò|Ó|Ô|Õ|Ö|Ø|Ù|Ú|Û|Ü|Ý|Þ|ß|à|á|â|ã|ä|å|æ|ç|è|é|ê|ë|ì|í|î|ï|ð|ñ|ò|ó|ô|õ|ö|ø|ù|ú|û|ü|ý|þ|ÿ)/.test(String(value))
}
