import { databasePool } from '../../server/state.js'
import { missingMigrationKeys, REQUIRED_MIGRATIONS } from './migration-status.mjs'

if (!databasePool) {
  console.error('数据库未启用，无法执行部署兼容性检查。')
  process.exitCode = 2
} else {
  try {
    const [rows] = await databasePool.query(
      'SELECT migration_key FROM kq_schema_migration WHERE migration_key IN (?)',
      [REQUIRED_MIGRATIONS],
    )
    const missing = missingMigrationKeys(rows.map(row => String(row.migration_key)))
    const [[state]] = await databasePool.query(
      'SELECT schema_version FROM kq_relational_store_state WHERE state_key = ? LIMIT 1',
      ['metadata'],
    )
    const schemaVersion = Number(state?.schema_version || 0)
    if (missing.length || schemaVersion < 3) {
      throw new Error(`数据库版本不满足当前发布要求：缺少 ${missing.join(', ') || '无'}；schema_version=${schemaVersion}`)
    }
    console.log(JSON.stringify({ ready: true, schemaVersion, checkedMigrations: REQUIRED_MIGRATIONS }))
  } catch (error) {
    console.error(`数据库兼容性检查失败：${error.message}`)
    process.exitCode = 1
  } finally {
    await databasePool.end()
  }
}
