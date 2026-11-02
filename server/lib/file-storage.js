import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { currentDataContext } from './data-context.js'

const SAFE_FILENAME_BYTES_MAX = 255
const FILE_EXTENSION_BYTES_MAX = 200
const STORAGE_OWNER_KEY_PREFIX = 'u-'
const STORAGE_OWNER_KEY_LENGTH = 32

function validPathSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !/[\\/\0]/.test(value)
    && Buffer.byteLength(value, 'utf8') <= 255
}

function safeStoredName(value) {
  return validPathSegment(value) && path.posix.basename(value) === value
}

function pathWithin(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function safeJoin(root, ...segments) {
  if (typeof root !== 'string' || !root) throw new Error('文件存储根目录未配置')
  if (segments.some(segment => !validPathSegment(segment))) throw new Error('文件存储路径包含无效目录名')
  const resolved = path.resolve(root, ...segments)
  if (!pathWithin(root, resolved)) throw new Error('文件存储路径超出允许目录')
  return resolved
}

export function storageOwnerDirectoryName(storageOwnerId) {
  const ownerId = String(storageOwnerId || '')
  if (!ownerId || Buffer.byteLength(ownerId, 'utf8') > 1024 || /[\0-\x1f\x7f]/.test(ownerId)) {
    throw new Error('文件存储所有者标识无效')
  }
  const safeLiteral = /^[A-Za-z0-9._-]{1,64}$/.test(ownerId)
    && !ownerId.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(ownerId)
  if (safeLiteral) return ownerId
  const digest = crypto.createHash('sha256').update(ownerId, 'utf8').digest('hex').slice(0, STORAGE_OWNER_KEY_LENGTH)
  return `${STORAGE_OWNER_KEY_PREFIX}${digest}`
}

export function userStorageDirectory(storageOwnerId, root) {
  return safeJoin(root, storageOwnerDirectoryName(storageOwnerId))
}

export function createStoredFileName(displayName) {
  const originalName = String(displayName || '').replaceAll('\\', '/').split('/').at(-1) || 'unnamed'
  const rawExtension = path.posix.extname(originalName)
  if (Buffer.byteLength(rawExtension, 'utf8') > FILE_EXTENSION_BYTES_MAX) {
    throw Object.assign(new Error('文件扩展名过长，无法安全保存'), { status: 400 })
  }
  const extension = rawExtension.replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
  const nameHash = crypto.createHash('sha256').update(originalName, 'utf8').digest('hex').slice(0, 16)
  const storedName = `${nameHash}-${crypto.randomUUID()}${extension}`
  if (Buffer.byteLength(storedName, 'utf8') > SAFE_FILENAME_BYTES_MAX) {
    throw Object.assign(new Error('文件扩展名过长，无法安全保存'), { status: 400 })
  }
  return storedName
}

export function resolveStoredFilePath(file, legacyDirectory = '', usersRoot = '') {
  const storedName = file?.storedName
  if (!safeStoredName(storedName)) return ''

  if (file.storageOwnerId) {
    if (!usersRoot) return ''
    const targetPath = safeJoin(userStorageDirectory(file.storageOwnerId, usersRoot), storedName)
    const migrationName = file.storageMigration?.legacyStoredName
    if (typeof migrationName === 'string' && safeStoredName(migrationName) && legacyDirectory) {
      if (fs.existsSync(targetPath)) return targetPath
      const legacyPath = safeJoin(legacyDirectory, migrationName)
      if (fs.existsSync(legacyPath)) return legacyPath
    }
    return targetPath
  }

  if (!legacyDirectory) return ''
  return safeJoin(legacyDirectory, storedName)
}

export function storedFileExists(file, legacyDirectory = '', usersRoot = '') {
  const targetPath = resolveStoredFilePath(file, legacyDirectory, usersRoot)
  try { return Boolean(targetPath) && fs.statSync(targetPath).isFile() }
  catch { return false }
}

export async function moveFileExclusive(source, destination) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  try {
    await fs.promises.link(source, destination)
  } catch (error) {
    if (error.code === 'EEXIST') throw error
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL)
  }
  try {
    await fs.promises.unlink(source)
  } catch (error) {
    await fs.promises.unlink(destination).catch(() => {})
    throw error
  }
}

export async function restoreMovedFile(source, destination) {
  try {
    await fs.promises.link(destination, source)
  } catch (error) {
    if (error.code === 'EEXIST') throw error
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
    await fs.promises.copyFile(destination, source, fs.constants.COPYFILE_EXCL)
  }
  await fs.promises.unlink(destination)
}

export function removeStoredFiles(files = [], legacyDirectory = '', usersRoot = '') {
  const owners = new Set()
  let removed = 0
  for (const file of files) {
    const targetPath = resolveStoredFilePath(file, legacyDirectory, usersRoot)
    if (!targetPath) continue
    if (currentDataContext()?.deferCleanup?.(targetPath, false)) {
      removed += 1
      continue
    }
    try {
      fs.unlinkSync(targetPath)
      removed += 1
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (file?.storageOwnerId && usersRoot) owners.add(file.storageOwnerId)
  }
  for (const ownerId of owners) {
    try { fs.rmdirSync(userStorageDirectory(ownerId, usersRoot)) }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error }
  }
  return removed
}

export function removeEmptyLegacyDirectory(directory) {
  if (!directory) return false
  try {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false
    fs.rmdirSync(directory)
    return true
  } catch (error) {
    if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) return false
    throw error
  }
}

function cleanupEmptyLegacyResourceDirectories(data, roots) {
  for (const share of data?.shares || []) {
    if (!validPathSegment(String(share?.id || ''))) continue
    removeEmptyLegacyDirectory(safeJoin(roots.files, String(share.id)))
  }
  for (const task of data?.collections || []) {
    if (!validPathSegment(String(task?.id || ''))) continue
    const taskDirectory = safeJoin(roots.collections, String(task.id))
    for (const submission of task.submissions || []) {
      if (!validPathSegment(String(submission?.id || ''))) continue
      removeEmptyLegacyDirectory(safeJoin(taskDirectory, String(submission.id)))
    }
    removeEmptyLegacyDirectory(taskDirectory)
  }
}

function equalFileContent(left, right) {
  try {
    const leftStat = fs.statSync(left)
    const rightStat = fs.statSync(right)
    if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false
    const digest = target => new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(target)
      stream.on('data', chunk => hash.update(chunk))
      stream.once('error', reject)
      stream.once('end', () => resolve(hash.digest('hex')))
    })
    return Promise.all([digest(left), digest(right)]).then(([leftHash, rightHash]) => leftHash === rightHash)
  } catch {
    return Promise.resolve(false)
  }
}

function legacyFileEntries(data, roots) {
  const entries = []
  for (const share of data?.shares || []) {
    if (!validPathSegment(String(share?.id || ''))) continue
    const directory = safeJoin(roots.files, String(share.id))
    for (const file of Array.isArray(share.files) ? share.files : []) {
      entries.push({
        file,
        legacyDirectory: directory,
        legacyResourceDirectory: directory,
        storageOwnerId: file?.storageOwnerId || share.ownerUserId || share.ownerGuestId || `legacy-share:${share.id}`,
      })
    }
  }
  for (const task of data?.collections || []) {
    if (!validPathSegment(String(task?.id || ''))) continue
    for (const submission of task.submissions || []) {
      if (!validPathSegment(String(submission?.id || ''))) continue
      const directory = safeJoin(roots.collections, String(task.id), String(submission.id))
      const storageOwnerId = submission.submitterUserId
        || (submission.participantKey ? `collection-participant:${submission.participantKey}` : '')
        || `legacy-collection:${task.id}:${submission.id}`
      for (const file of Array.isArray(submission.files) ? submission.files : []) {
        entries.push({ file, legacyDirectory: directory, legacyResourceDirectory: safeJoin(roots.collections, String(task.id)), storageOwnerId: file?.storageOwnerId || storageOwnerId })
      }
    }
  }
  return entries
}

export async function migrateLegacyUserFiles(data, {
  persist = async () => {},
  usersRoot,
  legacyFilesRoot,
  legacyCollectionsRoot,
} = {}) {
  if (!usersRoot || !legacyFilesRoot || !legacyCollectionsRoot) throw new Error('旧文件迁移目录未完整配置')
  const roots = { files: legacyFilesRoot, collections: legacyCollectionsRoot }
  const entries = legacyFileEntries(data, roots)
  const pending = []
  const result = { inspected: entries.length, migrated: 0, resumed: 0, skipped: 0, failures: [] }

  for (const entry of entries) {
    const { file, legacyDirectory } = entry
    if (!file || typeof file !== 'object') { result.skipped += 1; continue }
    if (file.storageOwnerId && file.storageMigration) {
      pending.push({ file, legacyDirectory, resumed: true })
      continue
    }
    if (file.storageOwnerId) continue
    if (!safeStoredName(file.storedName)) {
      result.skipped += 1
      result.failures.push({ code: 'invalid_legacy_filename' })
      continue
    }
    const source = safeJoin(legacyDirectory, file.storedName)
    try {
      if (!fs.statSync(source).isFile()) { result.skipped += 1; continue }
    } catch (error) {
      if (error.code === 'ENOENT') { result.skipped += 1; continue }
      result.failures.push({ code: 'legacy_stat_failed' })
      continue
    }
    let storedName
    let destination
    for (let attempt = 0; attempt < 5; attempt += 1) {
      storedName = createStoredFileName(file.name || file.originalName || file.relativePath || file.storedName)
      destination = safeJoin(userStorageDirectory(entry.storageOwnerId, usersRoot), storedName)
      if (!fs.existsSync(destination)) break
    }
    if (fs.existsSync(destination)) {
      result.failures.push({ code: 'destination_collision' })
      continue
    }
    file.storageOwnerId = String(entry.storageOwnerId)
    file.storageMigration = { legacyStoredName: file.storedName }
    file.storedName = storedName
    pending.push({ file, legacyDirectory, resumed: false })
  }

  if (pending.some(item => !item.resumed)) await persist()

  let completed = false
  for (const item of pending) {
    const { file, legacyDirectory, legacyResourceDirectory } = item
    try {
      const legacyStoredName = file.storageMigration?.legacyStoredName
      if (!safeStoredName(legacyStoredName)) throw Object.assign(new Error('迁移标记中的旧文件名无效'), { code: 'INVALID_MIGRATION_MARKER' })
      const source = safeJoin(legacyDirectory, legacyStoredName)
      const destination = safeJoin(userStorageDirectory(file.storageOwnerId, usersRoot), file.storedName)
      const sourceExists = fs.existsSync(source)
      const destinationExists = fs.existsSync(destination)
      if (destinationExists && sourceExists) {
        if (await equalFileContent(source, destination)) {
          await fs.promises.unlink(source)
        } else {
          // A different file already occupies the randomly selected destination.
          // Persist a replacement name before moving any source bytes.
          let replacement
          for (let attempt = 0; attempt < 5; attempt += 1) {
            replacement = createStoredFileName(file.name || file.originalName || file.relativePath || legacyStoredName)
            const nextPath = safeJoin(userStorageDirectory(file.storageOwnerId, usersRoot), replacement)
            if (!fs.existsSync(nextPath)) break
            replacement = ''
          }
          if (!replacement) throw Object.assign(new Error('无法为迁移文件分配唯一名称'), { code: 'DESTINATION_COLLISION' })
          file.storedName = replacement
          await persist()
          await moveFileExclusive(source, safeJoin(userStorageDirectory(file.storageOwnerId, usersRoot), replacement))
        }
      } else if (sourceExists) {
        await moveFileExclusive(source, destination)
      } else if (!destinationExists) {
        throw Object.assign(new Error('旧文件和新文件均不存在'), { code: 'MIGRATION_SOURCE_MISSING' })
      }
      delete file.storageMigration
      completed = true
      if (item.resumed) result.resumed += 1
      else result.migrated += 1
      removeEmptyLegacyDirectory(legacyDirectory)
      if (legacyResourceDirectory !== legacyDirectory) removeEmptyLegacyDirectory(legacyResourceDirectory)
    } catch (error) {
      result.failures.push({ code: error.code || 'migration_failed' })
    }
  }

  cleanupEmptyLegacyResourceDirectories(data, roots)
  if (completed || pending.some(item => item.file.storageMigration)) await persist()
  return result
}

export function removeUnreferencedUserFiles(data, cutoff = Date.now(), root, { legacyFilesRoot, legacyCollectionsRoot } = {}) {
  if (!root || !legacyFilesRoot || !legacyCollectionsRoot) throw new Error('孤立文件清理目录未完整配置')
  const referenced = new Set()
  for (const entry of legacyFileEntries(data, { files: legacyFilesRoot, collections: legacyCollectionsRoot })) {
    const file = entry.file
    if (!file?.storageOwnerId) continue
    const target = resolveStoredFilePath(file, entry.legacyDirectory, root)
    if (target) referenced.add(path.resolve(target))
    if (file.storageMigration?.legacyStoredName) {
      try { referenced.add(path.resolve(safeJoin(entry.legacyDirectory, file.storageMigration.legacyStoredName))) } catch {}
    }
  }

  let removed = 0
  let removedDirectories = 0
  let directories = []
  try { directories = fs.readdirSync(root, { withFileTypes: true }) } catch { return { removed, removedDirectories } }
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    const hashedOwnerDirectory = new RegExp(`^${STORAGE_OWNER_KEY_PREFIX}[a-f0-9]{${STORAGE_OWNER_KEY_LENGTH}}$`).test(directory.name)
    const literalOwnerDirectory = /^[A-Za-z0-9._-]{1,64}$/.test(directory.name)
      && !directory.name.endsWith('.')
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(directory.name)
    if (!hashedOwnerDirectory && !literalOwnerDirectory) continue
    const folder = safeJoin(root, directory.name)
    let entries = []
    try { entries = fs.readdirSync(folder, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const target = safeJoin(folder, entry.name)
      if (referenced.has(path.resolve(target))) continue
      try {
        if (fs.statSync(target).mtimeMs < cutoff) {
          fs.unlinkSync(target)
          removed += 1
        }
      } catch {}
    }
    try { fs.rmdirSync(folder); removedDirectories += 1 }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error }
  }
  return { removed, removedDirectories }
}
