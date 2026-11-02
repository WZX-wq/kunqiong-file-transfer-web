import crypto from 'node:crypto'
import { diskKeyDigest } from './file-path-key.js'

export const WRITE_LOCK_SCHEMA = `CREATE TABLE IF NOT EXISTS kq_write_lock (
  lock_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY
) ENGINE=InnoDB`

export async function lockWriteScope(connection, keys) {
  const digests = [...new Set(keys.filter(Boolean).map(key => crypto.createHash('sha256').update(key).digest('hex')))].sort()
  for (const key of digests) {
    // 直接取排他锁：INSERT IGNORE 命中已有行时先拿共享锁，随后 SELECT ... FOR UPDATE
    // 再升级为排他锁，两个同 key 事务会互相等待形成 S→X 升级死锁（压测已复现）。
    // ON DUPLICATE KEY UPDATE 在重复键路径直接持有排他行锁，天然串行化同 key 写入。
    await connection.execute('INSERT INTO kq_write_lock (lock_key) VALUES (?) ON DUPLICATE KEY UPDATE lock_key = lock_key', [key])
  }
}

export function changeLockKeys(changes, authorizedUserId = '', base = {}) {
  const keys = authorizedUserId ? [`user:${authorizedUserId}`] : []
  for (const change of changes) {
    keys.push(`entity:${change.table}:${change.key}`)
    if (change.owner && change.table !== 'kq_guest_usage') keys.push(`user:${change.owner}`)
    if (change.table === 'kq_user') {
      keys.push(`user:${change.key}`)
      for (const field of ['email', 'phone']) if (change.value[field]) keys.push(`contact:${field}:${String(change.value[field]).toLowerCase()}`)
    }
    if (change.table === 'kq_organization') keys.push(`organization:${change.key}`, `organization-name:${change.value.name}`)
    if (change.table === 'kq_resource') for (const resource of [change.value, ...(base.shares || []), ...(base.collections || [])].filter(item => (item.id || item.token) === change.key)) {
      if (resource.ownerUserId) keys.push(`user:${resource.ownerUserId}`)
      if (resource.ownerGuestKey) keys.push(`guest:${resource.ownerGuestKey}`)
      if (resource.teamOrganizationId) keys.push(`organization:${resource.teamOrganizationId}`)
      for (const file of [...(resource.files || []), ...(resource.submissions || []).flatMap(item => item.files || [])]) {
        if (file.storedName) keys.push(`disk:${diskKeyDigest(file.storageOwnerId || resource.ownerUserId || `legacy:${change.key}`, file.storedName)}`)
      }
    }
    if (change.table === 'kq_auth_session' && change.value.user?.id) keys.push(`user:${change.value.user.id}`)
  }
  return keys
}
