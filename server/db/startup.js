import fs from 'node:fs/promises'
import path from 'node:path'
import { databaseEnabled, projectRoot, relationalSchemaEnabled } from '../config.js'
import { databasePool } from '../state.js'
import { applyRelationalSchema } from './apply-relational-schema.js'

export async function initializeRelationalSchemaOnStartup() {
  if (!relationalSchemaEnabled) return null
  if (!databaseEnabled || !databasePool) {
    throw new Error('KUNQIONG_RELATIONAL_SCHEMA_ENABLED=true requires KUNQIONG_DB_ENABLED=true')
  }

  const schemaPath = path.join(projectRoot, 'docs', '数据库设计-2026-10-29', '03-现有功能关系表设计.sql')
  const schemaSql = await fs.readFile(schemaPath, 'utf8')
  return applyRelationalSchema({ pool: databasePool, schemaSql })
}
