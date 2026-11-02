import { databasePool } from '../../server/state.js'
import { requireSharedDataKey } from '../../server/lib/private-key.js'
import { migrateOnDemandSchema } from '../../server/db/on-demand-schema.js'

if (process.argv[2] !== '--apply' || !databasePool) {
  console.error('用法：配置数据库后运行 node scripts/db/migrate-on-demand.mjs --apply（显式迁移，不在服务启动时运行）')
  process.exitCode = 2
} else {
  try {
    requireSharedDataKey()
    console.log(JSON.stringify(await migrateOnDemandSchema(databasePool)))
  } catch (error) {
    console.error(`按需查询迁移失败：${error.message}`)
    process.exitCode = 1
  } finally { await databasePool.end() }
}
