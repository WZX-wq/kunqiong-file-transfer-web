// 并发写安全回归：写锁死锁、提交重试、N+1 读取。
// 仅在显式指定 KUNQIONG_TEST_DB_PORT 的隔离 MySQL 上运行，随机库名，结束删库。
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DB_COMMIT_ATTEMPTS = '4'
const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)

const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { ensureRelationalStoreSchema, initializeRelationalMetadata, loadRelationalMetadata } = await import('../../server/db/relational-store.js')
const { migrateNormalizedSchema } = await import('../../server/db/normalized-schema.js')
const { lockWriteScope } = await import('../../server/db/write-locks.js')
const { RelationalRequestStore } = await import('../../server/db/request-store.js')
const { normalizeMetadata } = await import('../../server/lib/metadata-normalizers.js')
const { isRetryableCommitError, commitAttempts } = await import('../../server/db/commit-retry.js')

const schemaSql = fs.readFileSync(new URL('../../docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql', import.meta.url), 'utf8')

function seedMetadata() {
  const now = new Date().toISOString()
  const future = new Date(Date.now() + 86400000).toISOString()
  const users = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const id = `concurrency-user-${index}`
    return [id, { id, username: id, nickname: `并发用户${index}`, status: 'active', planId: 'member', createdAt: now }]
  }))
  const organization = {
    id: 'concurrency-org', slug: 'concurrency-team', name: '并发测试团队', ownerUserId: 'concurrency-user-0', createdAt: now, updatedAt: now,
    members: Object.values(users).map((user, index) => ({ id: `concurrency-member-${index}`, userId: user.id, displayName: user.nickname, role: index ? 'member' : 'owner', status: 'active', joinedAt: now })),
  }
  return normalizeMetadata({
    users,
    sessions: Object.keys(users).map(id => ({ id: `${id}-session`, user: { id, username: id }, expiresAt: future, createdAt: now })),
    organizations: { [organization.id]: organization },
    shares: [{ id: 'concurrency-share', code: 'CONC01', manageToken: 'concurrency-manage', ownerUserId: 'concurrency-user-0', status: 'active', createdAt: now, expiresAt: future, downloadCount: 0, teamResource: false, files: [{ name: 'a.txt', relativePath: 'a.txt', storedName: 'a.txt', storageOwnerId: 'concurrency-user-0', size: 3, mimeType: 'text/plain' }] }],
    messages: Object.fromEntries(Object.keys(users).map(id => [id, Array.from({ length: 3 }, (_, index) => ({ id: `${id}-message-${index}`, title: `消息${index}`, body: '正文', category: 'system', createdAt: now, unread: true }))])),
    records: {},
    systemConfig: {},
    guestUsage: {},
  })
}

test('并发写入安全与读取放大回归', { skip: !port, timeout: 180000 }, async t => {
  assert.ok(port >= 1024 && port <= 65535, 'KUNQIONG_TEST_DB_PORT 必须是有效端口')
  const name = `kunqiong_concurrency_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database: name, connectionLimit: 12, timezone: 'Z' })
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE \`${name}\``); await admin.end() })

  await applyRelationalSchema({ pool, schemaSql })
  await ensureRelationalStoreSchema(pool)
  await migrateNormalizedSchema(pool)
  await initializeRelationalMetadata(pool, seedMetadata())

  await t.test('同 key 并发写锁不再产生 S→X 死锁', async () => {
    const outcomes = await Promise.all(Array.from({ length: 20 }, async (_, worker) => {
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        await lockWriteScope(connection, ['entity:kq_resource:lock-contention', `user:concurrency-user-${worker % 4}`])
        await connection.query('UPDATE kq_user SET write_version = write_version + 1 WHERE legacy_id = ?', [`concurrency-user-${worker % 4}`])
        await connection.commit()
        return 'ok'
      } catch (error) {
        await connection.rollback().catch(() => {})
        return error.code || 'ERROR'
      } finally { connection.release() }
    }))
    assert.deepEqual(outcomes.filter(value => value === 'ok').length, 20, `写锁竞争失败：${JSON.stringify(outcomes)}`)
    const [rows] = await pool.query("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'")
    assert.equal(Number(rows[0]?.Value ?? 0), 0, '写锁竞争不应产生 InnoDB 死锁')
  })

  await t.test('死锁与容量冲突自动有界重试后成功', async () => {
    const store = new RelationalRequestStore(pool)
    await store.users(['concurrency-user-0'])
    store.data.users['concurrency-user-0'].nickname = '重试后昵称'
    let attempts = 0
    let refreshes = 0
    store.beforeCommit = async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' })
      if (attempts === 2) throw Object.assign(new Error('capacity'), { status: 409, code: 'CAPACITY_CHANGED' })
    }
    store.refreshConflictState = async () => { refreshes += 1 }
    await store.commit()
    assert.equal(attempts, 3, '应重试两次后第三次成功')
    assert.equal(refreshes, 2, '每次重试前都应刷新请求内用量基线')
    const [[row]] = await pool.query('SELECT nickname FROM kq_user WHERE legacy_id = ?', ['concurrency-user-0'])
    assert.equal(row?.nickname, '重试后昵称', '重试成功后应落库')
  })

  await t.test('不可重试冲突立即失败且不重放', async () => {
    const store = new RelationalRequestStore(pool)
    await store.users(['concurrency-user-1'])
    store.data.users['concurrency-user-1'].nickname = '不应写入'
    let attempts = 0
    store.beforeCommit = async () => { attempts += 1; throw Object.assign(new Error('conflict'), { status: 409, code: 'DATA_CONFLICT' }) }
    await assert.rejects(store.commit(), /conflict/)
    assert.equal(attempts, 1)
  })

  await t.test('提交前断线丢弃未提交写入并仅恢复一次', async () => {
    const userId = 'concurrency-user-3'
    const [[before]] = await pool.query('SELECT nickname, write_version FROM kq_user WHERE legacy_id = ?', [userId])
    const store = new RelationalRequestStore(pool)
    await store.users([userId])
    store.data.users[userId].nickname = '断线恢复后保存'
    let attempts = 0
    store.beforeCommit = async connection => {
      attempts += 1
      if (attempts === 1) {
        await connection.query('UPDATE kq_user SET nickname = ? WHERE legacy_id = ?', ['事务临时值', userId])
        throw Object.assign(new Error('fixture connection lost before commit'), { code: 'ECONNRESET' })
      }
      const [[row]] = await connection.query('SELECT nickname FROM kq_user WHERE legacy_id = ?', [userId])
      assert.equal(row.nickname, before.nickname, '第一次事务的写入必须已回滚')
    }
    await store.commit()
    assert.equal(attempts, 2)
    const [[after]] = await pool.query('SELECT nickname, write_version FROM kq_user WHERE legacy_id = ?', [userId])
    assert.equal(after.nickname, '断线恢复后保存')
    assert.equal(Number(after.write_version), Number(before.write_version) + 1)

    const failing = new RelationalRequestStore(pool)
    await failing.users([userId])
    failing.data.users[userId].nickname = '不应保存'
    let failures = 0
    failing.beforeCommit = async () => { failures++; throw Object.assign(new Error('still lost'), { code: 'DATABASE_QUERY_TIMEOUT' }) }
    await assert.rejects(failing.commit(), { code: 'DATABASE_QUERY_TIMEOUT' })
    assert.equal(failures, 2, '网络恢复只能一次，不耗尽其他冲突的全部重试次数')
    const [[unchanged]] = await pool.query('SELECT nickname FROM kq_user WHERE legacy_id = ?', [userId])
    assert.equal(unchanged.nickname, after.nickname)
  })

  await t.test('COMMIT 已发出后确认丢失不重放事务', async () => {
    let acquisitions = 0
    const lossyPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'getConnection') return async () => {
          acquisitions++
          const connection = await target.getConnection()
          return new Proxy(connection, {
            get(conn, method) {
              if (method === 'commit') return async () => {
                await conn.commit()
                throw Object.assign(new Error('commit acknowledgement lost'), { code: 'ECONNRESET' })
              }
              const value = conn[method]
              return typeof value === 'function' ? value.bind(conn) : value
            },
          })
        }
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const userId = 'concurrency-user-4'
    const [[before]] = await pool.query('SELECT write_version FROM kq_user WHERE legacy_id = ?', [userId])
    const store = new RelationalRequestStore(lossyPool)
    await store.users([userId])
    store.data.users[userId].nickname = '已提交但确认丢失'
    await assert.rejects(store.commit(), { code: 'ECONNRESET' })
    assert.equal(acquisitions, 1)
    const [[after]] = await pool.query('SELECT nickname, write_version FROM kq_user WHERE legacy_id = ?', [userId])
    assert.equal(after.nickname, '已提交但确认丢失')
    assert.equal(Number(after.write_version), Number(before.write_version) + 1)
  })

  await t.test('通知读取合并为批量查询，不再按成员 N+1', async () => {
    const counter = { queries: 0 }
    const countingPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'query' || key === 'execute') return (sql, params) => { counter.queries += 1; return target.query(sql, params) }
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const store = new RelationalRequestStore(countingPool)
    await store.notifications(Array.from({ length: 20 }, (_, index) => `concurrency-user-${index}`))
    assert.equal(Object.keys(store.data.messages).length, 20, '每个账号的消息都应加载')
    for (const [id, messages] of Object.entries(store.data.messages)) assert.equal(messages.length, 3, `${id} 应加载 3 条消息`)
    assert.ok(counter.queries <= 10, `冷通知按数据体积分批，不能逐账号读取，实际 ${counter.queries} 条 SQL`)
    counter.queries = 0
    const repeated = new RelationalRequestStore(countingPool)
    await repeated.notifications(Array.from({ length: 20 }, (_, index) => `concurrency-user-${index}`))
    assert.ok(counter.queries <= 5, `重复通知只校验版本，实际 ${counter.queries} 条 SQL`)
    assert.equal(Object.values(repeated.data.messages).flat().length, 60)
  })

  await t.test('分页查询固定 (user_id, id) 索引，避免优化器回退 filesort', async () => {
    const statements = []
    const recordingPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'query') return (sql, params) => { statements.push(String(sql)); return target.query(sql, params) }
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const store = new RelationalRequestStore(recordingPool)
    await store.users(['concurrency-user-2'])
    const [[user]] = await pool.query("SELECT id FROM kq_user WHERE legacy_id = 'concurrency-user-2'")
    await store.page('kq_message', 'user_id = ?', [user.id], { limit: 50 })
    const messageSql = statements.find(sql => /SELECT id FROM .*kq_message/.test(sql)) || ''
    assert.match(messageSql, /FORCE INDEX \(`idx_messages_owner_page`\)/, messageSql)
    statements.length = 0
    await store.page('kq_account_record', 'user_id = ?', [user.id], { limit: 50, cursor: '99999' })
    const recordSql = statements.find(sql => /SELECT id FROM .*kq_account_record/.test(sql)) || ''
    assert.match(recordSql, /FORCE INDEX \(`idx_records_owner_page`\)/, recordSql)
    assert.match(recordSql, /AND id < \?/, recordSql)
  })

  await t.test('重试策略分类正确', async () => {
    assert.equal(isRetryableCommitError({ code: 'ER_LOCK_DEADLOCK' }), true)
    assert.equal(isRetryableCommitError({ code: 'ER_LOCK_WAIT_TIMEOUT' }), true)
    assert.equal(isRetryableCommitError({ code: 'CAPACITY_CHANGED' }), true)
    assert.equal(isRetryableCommitError({ code: 'DATA_CONFLICT' }), false)
    assert.equal(isRetryableCommitError({ code: 'DATABASE_QUERY_TIMEOUT' }), false, '提交确认丢失不能自动重放')
    assert.equal(commitAttempts(), 4)
  })
})
