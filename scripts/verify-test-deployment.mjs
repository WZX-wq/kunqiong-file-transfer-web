// Run on the test-server runner after deployment; never print account or secret data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { countRelationalModelRows } from '../server/db/relational-store.js'
import { normalizeAuditLog } from '../server/lib/audit-normalizer.js'
import { listValidAuditIds, readFixtureMetadata } from './lib/read-audit-fixture.mjs'

const app = process.env.KUNQIONG_DEPLOY_APP_NAME || 'kunqiong-file-transfer-web'
const image = app + ':test'
const root = path.resolve(import.meta.dirname, '..')
const expected = process.env.GITHUB_SHA || process.env.GITEA_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 ** 2 }).trim()
const stableSnapshotJson = value => Array.isArray(value) ? `[${value.map(stableSnapshotJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSnapshotJson(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const info = JSON.parse(docker(['inspect', app]))[0]
assert.equal(info.State.Running, true, 'Deployed app must be running')
assert.equal(info.Image, docker(['image', 'inspect', '-f', '{{.Id}}', image]), 'Container must use the newly built image')
assert.equal(info.Config.Labels?.['org.opencontainers.image.revision'], expected, 'Image provenance must match the full release SHA')
const files = execFileSync('git', ['ls-files', '-z', 'server', 'server.mjs', 'package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const manifest = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
const backupMarker = path.join(process.env.KUNQIONG_COMPOSE_DIR || '/opt/' + app, '.last-deployment-backup')
let previous = null
if (fs.existsSync(backupMarker)) {
  const backup = fs.readFileSync(backupMarker, 'utf8').trim()
  const metadataFile = ['metadata.json', 'metadata.json.bak']
    .map(name => path.join(backup, name))
    .find(filename => fs.existsSync(filename))
  if (metadataFile) {
    assert.ok(fs.existsSync(path.join(backup, 'backup-complete.json')), 'Data backup must finish before deployment')
    const data = readFixtureMetadata(metadataFile, { normalize: normalizeAuditLog })
    const revisionFile = path.join(backup, 'metadata.json.revision')
    const auditDirectory = path.join(path.dirname(metadataFile), 'audit')
    previous = {
      sourceSha256: crypto.createHash('sha256').update(stableSnapshotJson(JSON.parse(fs.readFileSync(metadataFile, 'utf8')))).digest('hex'),
      sourceRevision: Math.max(Number(data._localRevision) || 0, fs.existsSync(revisionFile) ? Number(fs.readFileSync(revisionFile, 'utf8').trim()) || 0 : 0),
      rowCounts: countRelationalModelRows(data),
      auditRetainedRows: Array.isArray(data.auditLogs) ? data.auditLogs.length : 0,
      auditJournalArtifacts: ['snapshot.json', 'snapshot.json.bak', 'events.jsonl']
        .some(name => fs.existsSync(path.join(auditDirectory, name))),
      auditIds: listValidAuditIds(data.auditLogs, normalizeAuditLog),
      auditTypesById: Object.fromEntries(data.auditLogs.filter(item => String(item?.id || '').trim()).map(item => {
        const log = normalizeAuditLog(item)
        return [String(log.id), log.type]
      })),
      users: Object.keys(data.users || {}),
      shares: (data.shares || []).map(item => item.id),
      collections: (data.collections || []).map(item => item.id),
      organizations: Object.values(data.organizations || {}).map(item => item.id),
      distributions: (data.distributions || []).map(item => item.id),
      upgradeOrders: (data.upgradeOrders || []).map(item => item.id),
    }
  }
}
const probe = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import mysql from 'mysql2/promise';
import {databaseEnabled, relationalSchemaEnabled, databaseHost, databasePort, databaseName, databaseUser, databasePassword} from '/app/server/config.js';
import {readRelationalState, loadRelationalMetadataFromConnection} from '/app/server/db/relational-store.js';
const manifest = ${JSON.stringify(manifest)};
const expected = ${JSON.stringify(expected)};
const previous = ${JSON.stringify(previous)};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [file, digest] of Object.entries(manifest)) assert.equal(hash('/app/' + file), digest, 'Runtime source mismatch: ' + file);
const base = 'http://127.0.0.1:' + (process.env.PORT || 8045);
const appOrigin = (() => { try { return new URL(process.env.KUNQIONG_APP_URL).origin; } catch { return new URL(base).origin; } })();
const healthResponse = await fetch(base + '/api/health');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.release, expected, 'Live health release must match the full commit');
assert.equal(databaseEnabled, true, 'Deployed application must use MySQL');
assert.equal(relationalSchemaEnabled, true, 'Deployed application must use relational metadata tables');
assert.ok(databaseHost && databaseName && databaseUser, 'Deployed MySQL connection must be configured');
const databasePool = mysql.createPool({host:databaseHost, port:databasePort, database:databaseName, user:databaseUser, password:databasePassword, connectionLimit:1, charset:'utf8mb4'});
let relationalState, relationalMetadata, databaseEvidence;
try {
  const connection = await databasePool.getConnection();
  try {
    relationalState = await readRelationalState(connection);
    relationalMetadata = await loadRelationalMetadataFromConnection(connection, relationalState);
    if (previous?.auditJournalArtifacts) {
      assert.equal(relationalMetadata.metadata.auditJournalMigration, 'local-audit-journal-v1', 'The local audit journal import receipt must be durably stored in MySQL metadata');
    }
    const [auditCounts] = await connection.query('SELECT (SELECT COUNT(*) FROM kunqiong_audit_log) AS source_count, (SELECT COUNT(*) FROM kq_audit_log) AS relational_count');
    const [uploadSessionRows] = await connection.query('SELECT COUNT(*) AS total FROM kq_upload_session');
    const expectedAuditIds = previous?.auditIds || [];
    let importedSourceAuditRows = 0, importedRelationalAuditRows = 0;
    if (expectedAuditIds.length) {
      const placeholders = expectedAuditIds.map(() => '?').join(',');
      const [sourceMatchedRows] = await connection.execute('SELECT id FROM kunqiong_audit_log WHERE id IN (' + placeholders + ')', expectedAuditIds);
      const sourceMatchedIds = new Set(sourceMatchedRows.map(row => String(row.id)));
      const [relationalMatchedRows] = await connection.execute('SELECT legacy_id FROM kq_audit_log WHERE legacy_id IN (' + placeholders + ')', expectedAuditIds);
      const relationalMatchedIds = new Set(relationalMatchedRows.map(row => String(row.legacy_id)));
      importedSourceAuditRows = sourceMatchedIds.size;
      importedRelationalAuditRows = relationalMatchedIds.size;
      const missingSourceIds = expectedAuditIds.filter(id => !sourceMatchedIds.has(id));
      const missingSourceIdLengths = Object.groupBy(missingSourceIds, id => String(id).length);
      const missingSourceTypes = Object.groupBy(missingSourceIds, id => previous.auditTypesById[id] || 'unknown');
      assert.equal(importedSourceAuditRows, expectedAuditIds.length, 'Every valid backed-up audit log must be imported into the MySQL source table (valid=' + expectedAuditIds.length + ', retained_backup_rows=' + previous.auditRetainedRows + ', missing_id_lengths=' + JSON.stringify(Object.fromEntries(Object.entries(missingSourceIdLengths).map(([length, ids]) => [length, ids.length]))) + ', missing_types=' + JSON.stringify(Object.fromEntries(Object.entries(missingSourceTypes).map(([type, ids]) => [type, ids.length]))) + ')');
      const missingRelationalIds = expectedAuditIds.filter(id => !relationalMatchedIds.has(id));
      const missingRelationalTypes = Object.groupBy(missingRelationalIds, id => previous.auditTypesById[id] || 'unknown');
      assert.equal(importedRelationalAuditRows, expectedAuditIds.length, 'Every valid backed-up audit log must be mirrored into the relational audit table (valid=' + expectedAuditIds.length + ', retained_backup_rows=' + previous.auditRetainedRows + ', missing_types=' + JSON.stringify(Object.fromEntries(Object.entries(missingRelationalTypes).map(([type, ids]) => [type, ids.length]))) + ')');
    }
    databaseEvidence = {revision:relationalState.revision, sourceSnapshotRevision:relationalState.sourceSnapshotRevision, managedRows:Object.values(relationalMetadata.state.counts).reduce((total, count) => total + Number(count || 0), 0), migratedTableCount:Object.keys(relationalMetadata.state.counts).length, sourceAuditRows:Number(auditCounts[0].source_count), relationalAuditRows:Number(auditCounts[0].relational_count), importedSourceAuditRows, importedRelationalAuditRows, retainedBackupAuditRows:previous?.auditRetainedRows ?? null, expectedValidAuditRows:previous?.auditIds.length ?? null, uploadSessions:Number(uploadSessionRows[0].total)};
  } finally { connection.release(); }
  assert.ok(databaseEvidence.managedRows > 0, 'Migrated business records must exist in relational tables');
  const migrationReceipt = relationalMetadata.metadata._relationalMigration;
  assert.ok(migrationReceipt && ['metadata.json', 'kunqiong_app_state'].includes(migrationReceipt.source), 'A legacy migration receipt must be present in MySQL');
  assert.equal(Number(migrationReceipt.sourceRevision), databaseEvidence.sourceSnapshotRevision, 'The source revision must match the migration state');
  if (migrationReceipt.source === 'metadata.json') {
    assert.ok(previous, 'A pre-deployment JSON snapshot is required to verify the migration');
    assert.equal(migrationReceipt.sourceSha256, previous.sourceSha256, 'The imported JSON must match the pre-deployment backup');
    assert.equal(Number(migrationReceipt.sourceRevision), Number(previous.sourceRevision), 'The source revision must match the backed-up JSON revision');
    for (const [table, expectedCount] of Object.entries(previous.rowCounts || {})) {
      assert.equal(Number(migrationReceipt.sourceCounts[table] || 0), Number(expectedCount), 'Migration source row count differs from the backed-up JSON: ' + table);
    }
    assert.deepEqual(Object.keys(previous.rowCounts || {}).sort(), Object.keys(relationalMetadata.state.counts || {}).sort(), 'Backup row-count manifest must cover every managed relation table');
  }
  assert.deepEqual(migrationReceipt.importedCounts, relationalMetadata.state.counts, 'Imported row counts must match committed relationship-table counts');
  assert.equal(relationalMetadata.metadata.auditStorage, 'mysql-v1', 'MySQL audit persistence must be active');
  assert.equal(relationalMetadata.metadata.auditLogs.length, 0, 'Business metadata must not embed audit history');
  assert.equal(databaseEvidence.sourceAuditRows, databaseEvidence.relationalAuditRows, 'Audit source and relational mirror counts must match');
} finally { await databasePool.end(); }
const html = fs.readFileSync('/app/dist/index.html', 'utf8');
const seoStart = html.indexOf('<!--seo:start-->');
const seoEnd = html.indexOf('<!--seo:end-->');
assert.ok(seoStart >= 0 && seoEnd > seoStart, 'Built HTML must contain the SEO injection markers');
const sharedHead = html.slice(0, seoStart);
const sharedTail = html.slice(seoEnd + '<!--seo:end-->'.length);
const pages = [
  {route:'/', title:'鲲穹文件传输 - 免登录大文件传输与文件收集平台', robots:'index,follow,max-image-preview:large'},
  {route:'/workspace', title:'工作台 - 鲲穹文件传输', robots:'noindex,follow'},
  {route:'/team', title:'团队空间 - 鲲穹文件传输', robots:'noindex,follow'},
  {route:'/admin', title:'管理后台 - 鲲穹文件传输', robots:'noindex,follow'},
];
for (const {route, title, robots} of pages) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, 'Page unavailable: ' + route);
  const page = await response.text();
  assert.ok(page.startsWith(sharedHead) && page.endsWith(sharedTail), 'Page serves an old build: ' + route);
  assert.ok(!page.includes('<!--seo:'), 'SEO markers must be replaced: ' + route);
  assert.ok(page.includes('<title>' + title + '</title>'), 'Route title is incorrect: ' + route);
  assert.ok(page.includes('<meta name="robots" content="' + robots + '" />'), 'Route indexing policy is incorrect: ' + route);
  assert.ok(page.includes('<link rel="canonical" href="' + appOrigin + route + '" />'), 'Route canonical is incorrect: ' + route);
}
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\\/assets\\/[^"\\s]+)"/g)].map(match => match[1]).concat(fs.readdirSync('/app/dist/assets').filter(name => /\\.(?:js|css)$/.test(name)).map(name => '/assets/' + name)))];
assert.ok(assets.length >= 2, 'Built assets must exist');
for (const asset of assets) {
  const response = await fetch(base + asset);
  assert.equal(response.status, 200, 'Asset unavailable: ' + asset);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), hash('/app/dist' + asset), 'Old asset served: ' + asset);
}
const workerAssets = assets.filter(asset => /office-preview-.*\\.js$/.test(asset));
assert.ok(workerAssets.length, 'Office preview worker must be deployed');
const {default:sharp} = await import('sharp');
const {normalizeAvatarData} = await import('/app/server/lib/avatar-validation.js');
const png = await sharp({create:{width:1,height:1,channels:3,background:'#4488ff'}}).png().toBuffer();
const avatar = await normalizeAvatarData('data:image/png;base64,' + png.toString('base64'));
assert.ok(avatar.startsWith('data:image/webp;base64,'), 'Native avatar decoder must reencode');
const avatarInfo = await sharp(Buffer.from(avatar.split(',')[1],'base64')).metadata();
assert.equal(avatarInfo.width,1); assert.equal(avatarInfo.height,1);
await assert.rejects(normalizeAvatarData('data:image/png;base64,c2FmZQ=='),error => error.status === 400);
for (const route of ['/api/account/workspace', '/api/account/team/overview']) {
  const response = await fetch(base + route); await response.arrayBuffer(); assert.equal(response.status, 401, 'Anonymous access must remain protected');
}
const foreign = await fetch(base + '/api/account/workspace', {method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'});
await foreign.arrayBuffer(); assert.equal(foreign.status, 403, 'Foreign origin must remain rejected');
await new Promise(resolve => setTimeout(resolve, 1500));
const metadataPath = '/app/storage/metadata.json';
const stored = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (previous) {
  const active = relationalMetadata.metadata;
  const current = {users:new Set(Object.keys(active.users || {})), shares:new Set(active.shares.map(item=>item.id)), collections:new Set(active.collections.map(item=>item.id)), organizations:new Set(Object.values(active.organizations || {}).map(item=>item.id)), distributions:new Set(active.distributions.map(item=>item.id)), upgradeOrders:new Set(active.upgradeOrders.map(item=>item.id))};
  for (const kind of ['users', 'shares', 'collections', 'organizations', 'distributions', 'upgradeOrders']) {
    const ids = previous[kind] || [];
    assert.ok(ids.every(id=>current[kind].has(id)), 'Pre-deployment data must remain: '+kind);
  }
}
const before = {hash:hash(metadataPath),mtime:fs.statSync(metadataPath).mtimeMs};
const requestIds = [];
for (let index = 0; index < 20; index++) {
  const response = await fetch(base + '/api/auth/me');
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.user, null);
  requestIds.push(response.headers.get('x-request-id'));
}
assert.equal(hash(metadataPath), before.hash, 'Reads must not rewrite business metadata');
assert.equal(fs.statSync(metadataPath).mtimeMs, before.mtime, 'Reads must not save the business snapshot');
const auditPlaceholders = requestIds.map(() => '?').join(',');
let requestAuditRows;
const auditPool = mysql.createPool({host:databaseHost, port:databasePort, database:databaseName, user:databaseUser, password:databasePassword, connectionLimit:1, charset:'utf8mb4'});
try {
  const connection = await auditPool.getConnection();
  try {
    [requestAuditRows] = await connection.execute("SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.requestId'))) AS total FROM kq_audit_log WHERE JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.requestId')) IN (" + auditPlaceholders + ')', requestIds);
    const [auditCounts] = await connection.query('SELECT (SELECT COUNT(*) FROM kunqiong_audit_log) AS source_count, (SELECT COUNT(*) FROM kq_audit_log) AS relational_count');
    assert.equal(Number(auditCounts[0].source_count), Number(auditCounts[0].relational_count), 'Audit source and relational mirror counts must match after verification requests');
  } finally { connection.release(); }
} finally { await auditPool.end(); }
assert.equal(Number(requestAuditRows[0].total), requestIds.length, 'Every verification read must be persisted in the relational audit table');
assert.equal(process.env.KUNQIONG_SCAN_MODE, 'required', 'Required scanning must stay enabled');
await new Promise((resolve,reject) => {
  const socket = net.connect(Number(process.env.KUNQIONG_CLAMAV_PORT || 3310), process.env.KUNQIONG_CLAMAV_HOST || '127.0.0.1');
  let body=''; socket.setTimeout(10000); socket.once('connect',()=>socket.write('zPING\\0'));
  socket.on('data',data=>{body+=data; if(body.includes('PONG')){socket.destroy();resolve();}});
  socket.once('error',reject); socket.once('timeout',()=>{socket.destroy();reject(new Error('Scanner timeout'));});
});
console.log(JSON.stringify({release:health.release,sourceFiles:Object.keys(manifest).length,pages:4,assets,workerAssets,avatarDecoder:'WebP 1x1; corrupt input rejected',database:databaseEvidence,migration:relationalMetadata.metadata._relationalMigration,auditStorage:relationalMetadata.metadata.auditStorage,readRequests:requestIds.length,businessSnapshotUnchanged:true,auditRequestsPersisted:true,previousDataVerified:Boolean(previous),preservedCounts:previous?Object.fromEntries(['users','shares','collections','organizations','distributions','upgradeOrders'].map(kind=>[kind,previous[kind].length])):null,scanner:'PONG',passed:true}));
`
const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: probe, encoding: 'utf8', windowsHide: true })
if (syntax.status !== 0) throw new Error(`Deployment probe syntax check failed: ${syntax.stderr || syntax.error?.message || ''}`)
const result = spawnSync('docker', ['exec', '-i', app, 'node', '--input-type=module'], { input: probe, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 ** 2 })
if (result.status !== 0) throw new Error(`Deployment verification failed (${result.status}): ${result.stderr || result.error?.message || ''}`)
console.log(result.stdout.trim())
