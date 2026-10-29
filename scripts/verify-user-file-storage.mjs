import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createStoredFileName, migrateLegacyUserFiles, removeUnreferencedUserFiles,
  resolveStoredFilePath, storageOwnerDirectoryName, userStorageDirectory,
} from '../server/lib/file-storage.js'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-user-storage-'))
const usersRoot = path.join(fixture, 'storage', 'users')
const legacyFilesRoot = path.join(fixture, 'storage', 'files')
const legacyCollectionsRoot = path.join(fixture, 'storage', 'collections')
const files = [
  { name: '签署版合同.pdf', storedName: 'original-contract.pdf' },
  { name: '报价单.xlsx', storedName: 'quote.xlsx' },
]
const collectionFile = { name: '身份证明.png', storedName: 'proof.png' }
const metadata = {
  shares: [{ id: 'old-share', ownerUserId: 'alice', files }],
  collections: [{
    id: 'old-collection', ownerUserId: 'collection-owner', submissions: [
      { id: 'alice-submission', submitterUserId: 'alice', files: [collectionFile] },
      { id: 'guest-submission', participantKey: 'guest-key', files: [{ name: '访客材料.txt', storedName: 'guest.txt' }] },
      { id: 'empty-submission', files: [] },
    ],
  }],
}

function writeLegacyFile(root, resourcePath, storedName, content) {
  const directory = path.join(root, resourcePath)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, storedName), content)
}

try {
  assert.equal(storageOwnerDirectoryName('alice'), 'alice')
  assert.ok(/^u-[a-f0-9]{32}$/.test(storageOwnerDirectoryName('../escape')))
  assert.ok(userStorageDirectory('alice', usersRoot).startsWith(usersRoot))

  const filename = createStoredFileName('签署版合同.pdf')
  const expectedHash = crypto.createHash('sha256').update('签署版合同.pdf').digest('hex').slice(0, 16)
  assert.match(filename, new RegExp(`^${expectedHash}-[0-9a-f-]{36}\\.pdf$`))
  assert.notEqual(createStoredFileName('签署版合同.pdf'), filename, 'same-name files receive unique random suffixes')
  assert.equal(resolveStoredFilePath({ storageOwnerId: 'alice', storedName: '../outside.txt' }, legacyFilesRoot, usersRoot), '')

  writeLegacyFile(legacyFilesRoot, 'old-share', files[0].storedName, 'contract-bytes')
  writeLegacyFile(legacyFilesRoot, 'old-share', files[1].storedName, 'quote-bytes')
  writeLegacyFile(legacyCollectionsRoot, path.join('old-collection', 'alice-submission'), collectionFile.storedName, 'proof-bytes')
  writeLegacyFile(legacyCollectionsRoot, path.join('old-collection', 'guest-submission'), 'guest.txt', 'guest-bytes')
  fs.mkdirSync(path.join(legacyCollectionsRoot, 'old-collection', 'empty-submission'), { recursive: true })

  let persistCount = 0
  const first = await migrateLegacyUserFiles(metadata, {
    usersRoot, legacyFilesRoot, legacyCollectionsRoot,
    persist: async () => { persistCount += 1 },
  })
  assert.equal(first.migrated, 4)
  assert.equal(first.failures.length, 0)
  assert.equal(persistCount, 2, 'migration intent and completion are both persisted')
  const entries = [
    ...files.map(file => ({ file, path: resolveStoredFilePath(file, legacyFilesRoot, usersRoot) })),
    { file: collectionFile, path: resolveStoredFilePath(collectionFile, path.join(legacyCollectionsRoot, 'old-collection', 'alice-submission'), usersRoot) },
    { file: metadata.collections[0].submissions[1].files[0], path: resolveStoredFilePath(metadata.collections[0].submissions[1].files[0], path.join(legacyCollectionsRoot, 'old-collection', 'guest-submission'), usersRoot) },
  ]
  assert.equal(new Set(entries.map(entry => entry.file.storageOwnerId)).size, 2, 'same user resources share one isolated directory')
  assert.notEqual(entries[0].file.storageOwnerId, entries[3].file.storageOwnerId, 'anonymous participant files use a separate identity')
  assert.ok(entries.every(entry => fs.existsSync(entry.path) && !entry.file.storageMigration))
  assert.deepEqual(entries.map(entry => fs.readFileSync(entry.path, 'utf8')), ['contract-bytes', 'quote-bytes', 'proof-bytes', 'guest-bytes'])
  assert.equal(fs.existsSync(path.join(legacyFilesRoot, 'old-share')), false, 'empty legacy share directory is removed')
  assert.equal(fs.existsSync(path.join(legacyCollectionsRoot, 'old-collection', 'empty-submission')), false, 'empty legacy submission directory without file metadata is removed')
  assert.equal(fs.existsSync(path.join(legacyCollectionsRoot, 'old-collection')), false, 'empty legacy collection directory is removed after all submissions migrate')

  const second = await migrateLegacyUserFiles(metadata, { usersRoot, legacyFilesRoot, legacyCollectionsRoot })
  assert.equal(second.migrated, 0)
  assert.equal(second.resumed, 0)
  assert.equal(second.failures.length, 0, 'migration is idempotent')

  const interruptedMetadata = { shares: [{ id: 'interrupted', ownerUserId: 'bob', files: [{ name: 'restart.docx', storedName: 'old.docx' }] }], collections: [] }
  writeLegacyFile(legacyFilesRoot, 'interrupted', 'old.docx', 'restart-bytes')
  await assert.rejects(migrateLegacyUserFiles(interruptedMetadata, {
    usersRoot, legacyFilesRoot, legacyCollectionsRoot,
    persist: async () => { throw new Error('simulated metadata interruption') },
  }), /simulated metadata interruption/)
  const resumed = await migrateLegacyUserFiles(interruptedMetadata, { usersRoot, legacyFilesRoot, legacyCollectionsRoot })
  assert.equal(resumed.resumed, 1)
  assert.equal(resumed.failures.length, 0)
  const resumedFile = interruptedMetadata.shares[0].files[0]
  assert.equal(fs.readFileSync(resolveStoredFilePath(resumedFile, '', usersRoot), 'utf8'), 'restart-bytes')

  const oldTime = Date.now() - 10_000
  const orphan = path.join(usersRoot, 'alice', createStoredFileName('orphan.bin'))
  fs.writeFileSync(orphan, 'unreferenced')
  fs.utimesSync(orphan, oldTime / 1000, oldTime / 1000)
  const cleanup = removeUnreferencedUserFiles(metadata, Date.now() - 1000, usersRoot, { legacyFilesRoot, legacyCollectionsRoot })
  assert.equal(cleanup.removed, 1)
  assert.equal(fs.existsSync(orphan), false)
  assert.ok(entries.every(entry => fs.existsSync(entry.path)), 'cleanup keeps every metadata-referenced file')

  console.log('PASS user directory isolation, hashed unique names, idempotent legacy migration, resume, and orphan cleanup')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
