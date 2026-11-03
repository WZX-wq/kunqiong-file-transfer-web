import path from 'node:path'
import { normalizeUploadFileName } from './file-name.js'

export const collectionFilePathKey = file => path.posix.normalize(normalizeUploadFileName(file.relativePath || file.name || '').replaceAll('\\', '/')).normalize('NFC').trim().toLowerCase()

export function isSameCollectionSubmitter(submission, submitter) {
  if (submitter.submitterUserId) return String(submission.submitterUserId || '') === String(submitter.submitterUserId)
  return Boolean(!submission.submitterUserId && submitter.participantKey && submission.participantKey === submitter.participantKey)
}

export function conflictsForNamedCollectionFiles(task, files, submitter) {
  const wanted = new Set(files.map(collectionFilePathKey)), found = new Map()
  for (const submission of task.submissions || []) {
    if (!isSameCollectionSubmitter(submission, submitter)) continue
    for (const file of submission.files || []) {
      const key = collectionFilePathKey(file)
      if (wanted.has(key) && !found.has(key)) found.set(key, { name: file.name || file.relativePath, relativePath: file.relativePath || file.name })
    }
  }
  return [...found.values()]
}

export const collectionFileConflictError = existingFiles => Object.assign(new Error('以下文件已存在，是否继续上传并覆盖？'), { status: 409, code: 'collection_file_exists', existingFiles })

// Called under the database resource lock after rebasing simultaneous requests.
// New bytes cannot silently collide with another request's just-committed files.
export function assertMergedCollectionPaths(before, desired, merged) {
  for (const submission of desired.submissions || []) {
    const original = (before.submissions || []).find(item => item.id === submission.id)
    const added = (submission.files || []).filter(file => !(original?.files || []).some(old => old.storedName === file.storedName && old.storageOwnerId === file.storageOwnerId))
    if (!added.length) continue
    const conflicts = conflictsForNamedCollectionFiles({ submissions: merged.filter(item => item.id !== submission.id) }, added, submission)
    if (conflicts.length) throw collectionFileConflictError(conflicts)
  }
}
