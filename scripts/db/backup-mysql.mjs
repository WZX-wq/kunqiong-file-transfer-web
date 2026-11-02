import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createGzip } from 'node:zlib'
import { pathToFileURL } from 'node:url'

export async function backupMysql(directory, env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.KUNQIONG_DB_ENABLED || '')) return { skipped: true, reason: 'standalone' }
  const database = env.KUNQIONG_DB_NAME, host = env.KUNQIONG_DB_HOST, user = env.KUNQIONG_DB_USER
  if (!database || !host || !user || /[\r\n\0]/.test(database)) throw new Error('Incomplete database backup configuration')
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  const target = path.join(directory, 'mysql.sql.gz'), partial = `${target}.partial`
  const lockPath = path.join(directory, '.mysql-backup-in-progress')
  const lock = await fs.promises.open(lockPath, 'wx', 0o600)
  try {
    for (const filename of [target, partial, path.join(directory, 'mysql-backup-complete.json')]) {
      try { await fs.promises.lstat(filename) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      throw Object.assign(new Error('Backup destination already contains database backup files'), { code: 'BACKUP_ALREADY_EXISTS' })
    }
    return await dumpMysql(directory, target, partial, env, { database, host, user })
  } finally {
    await lock.close()
    await fs.promises.unlink(lockPath)
  }
}

async function dumpMysql(directory, target, partial, env, { database, host, user }) {
  const child = spawn(env.KUNQIONG_MYSQL_DUMP_BIN || 'mariadb-dump', [
    '--single-transaction', '--quick', '--skip-lock-tables', '--no-tablespaces',
    '--hex-blob', '--triggers', '--routines', '--events',
    ...(env.KUNQIONG_DB_TLS === 'true' ? ['--ssl', '--ssl-verify-server-cert'] : []),
    '--host', host, '--port', String(env.KUNQIONG_DB_PORT || 3306), '--user', user, '--', database,
  ], { env: { ...env, MYSQL_PWD: env.KUNQIONG_DB_PASSWORD || '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  // Tool stderr can contain connection details. Keep it out of CI logs.
  child.stderr.resume()
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(Object.assign(new Error('MySQL dump failed; backup is incomplete'), { code: 'MYSQL_BACKUP_FAILED' })))
  })
  const digest = crypto.createHash('sha256')
  let bytes = 0
  const hash = new Transform({ transform(chunk, _encoding, done) { digest.update(chunk); bytes += chunk.length; done(null, chunk) } })
  const streamed = pipeline(child.stdout, createGzip(), hash, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }))
  try {
    await Promise.all([completed, streamed])
    if (!bytes) throw new Error('Empty MySQL backup')
    await fs.promises.rename(partial, target)
    const manifest = { format: 'mysql-logical-gzip-v1', database, file: 'mysql.sql.gz', sha256: digest.digest('hex'), bytes, completedAt: new Date().toISOString() }
    await fs.promises.writeFile(path.join(directory, 'mysql-backup-complete.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
    return manifest
  } catch (error) {
    child.kill()
    await Promise.allSettled([completed, streamed])
    await fs.promises.unlink(partial).catch(() => {})
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await backupMysql(process.argv[2] || '/backup'))) }
  catch (error) { console.error(JSON.stringify({ event: 'mysql_backup_failed', code: error.code || 'BACKUP_FAILED' })); process.exitCode = 1 }
}
