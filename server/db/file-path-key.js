import crypto from 'node:crypto'
import path from 'node:path'
import { normalizeUploadFileName } from '../lib/file-name.js'
import { storageOwnerDirectoryName } from '../lib/file-storage.js'

export const diskKeyDigest = (owner, name) => crypto.createHash('sha256').update(`${storageOwnerDirectoryName(owner)}/${name}`).digest('hex')

export function filePathDigest(file) {
  const normalized = path.posix.normalize(normalizeUploadFileName(file.relativePath || file.name || '').replaceAll('\\', '/'))
    .replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '').trim().toLowerCase() || '未命名文件'
  return crypto.createHash('sha256').update(normalized).digest('hex')
}
