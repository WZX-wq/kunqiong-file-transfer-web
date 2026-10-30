import fs from 'node:fs/promises'
import path from 'node:path'
import { databaseEnabled, projectRoot } from '../../server/config.js'
import { databasePool } from '../../server/state.js'
import { applyRelationalSchema } from '../../server/db/apply-relational-schema.js'
import { inspectRelationalSchemaSql } from '../../server/db/relational-schema.js'

const schemaPath = path.join(projectRoot, 'docs', '数据库设计-2026-10-29', '03-现有功能关系表设计.sql')
const schemaSql = await fs.readFile(schemaPath, 'utf8')
const [mode] = process.argv.slice(2)

if (mode === '--check') {
  const tables = inspectRelationalSchemaSql(schemaSql)
  console.log(`关系表结构检查通过：${tables.length} 张表；未连接数据库。`)
} else if (mode === '--apply') {
  if (!databaseEnabled || !databasePool) {
    console.error('未启用数据库。请先在项目环境配置 KUNQIONG_DB_ENABLED=true 及数据库连接参数，再执行此命令。')
    process.exitCode = 2
  } else {
    try {
      const result = await applyRelationalSchema({ pool: databasePool, schemaSql })
      console.log(`${result.alreadyApplied ? '结构已存在并通过核对' : '关系表结构已创建'}：${result.tableCount} 张表，迁移版本 ${result.migrationKey}。`)
      console.log('现有业务读写仍使用 kunqiong_app_state；本命令没有迁移业务数据或切换运行时存储。')
    } catch (error) {
      console.error(`数据库结构升级失败：${error.message}`)
      process.exitCode = 1
    } finally {
      await databasePool.end()
    }
  }
} else {
  console.log('用法：npm run db:schema:check 只做本地结构检查；npm run db:schema:apply 显式连接已配置数据库并创建缺失的关系表。')
  process.exitCode = 2
}
