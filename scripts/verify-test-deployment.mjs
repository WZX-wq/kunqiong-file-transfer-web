// Run on the test-server runner after deployment; never print account or secret data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

const app = process.env.KUNQIONG_DEPLOY_APP_NAME || 'kunqiong-file-transfer-web'
const image = app + ':test'
const root = path.resolve(import.meta.dirname, '..')
const expected = process.env.GITHUB_SHA || process.env.GITEA_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 ** 2 }).trim()
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
  const metadataFile = path.join(backup, 'metadata.json')
  if (fs.existsSync(metadataFile)) {
    assert.ok(fs.existsSync(path.join(backup, 'backup-complete.json')), 'Data backup must finish before deployment')
    const data = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
    previous = { users: Object.keys(data.users || {}), shares: (data.shares || []).map(item => item.id), collections: (data.collections || []).map(item => item.id), organizations: Object.values(data.organizations || {}).map(item => item.id) }
  }
}
const probe = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
const manifest = ${JSON.stringify(manifest)};
const expected = ${JSON.stringify(expected)};
const previous = ${JSON.stringify(previous)};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [file, digest] of Object.entries(manifest)) assert.equal(hash('/app/' + file), digest, 'Runtime source mismatch: ' + file);
const base = 'http://127.0.0.1:' + (process.env.PORT || 8045);
const healthResponse = await fetch(base + '/api/health');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.release, expected, 'Live health release must match the full commit');
for (const route of ['/', '/workspace', '/team', '/admin']) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, 'Page unavailable: ' + route);
  assert.equal(await response.text(), fs.readFileSync('/app/dist/index.html', 'utf8'), 'Page serves an old build: ' + route);
}
const html = fs.readFileSync('/app/dist/index.html', 'utf8');
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
  const current = {users:new Set(Object.keys(stored.users || {})), shares:new Set(stored.shares.map(item=>item.id)), collections:new Set(stored.collections.map(item=>item.id)), organizations:new Set(Object.values(stored.organizations || {}).map(item=>item.id))};
  for (const [kind, ids] of Object.entries(previous)) assert.ok(ids.every(id=>current[kind].has(id)), 'Pre-deployment data must remain: '+kind);
}
assert.equal(stored.auditStorage, 'journal-v1', 'Independent audit migration must be active');
assert.equal(stored.auditLogs.length, 0, 'Business snapshot must not embed audit history');
const before = {hash:hash(metadataPath),mtime:fs.statSync(metadataPath).mtimeMs};
const requestIds = [];
for (let index = 0; index < 20; index++) {
  const response = await fetch(base + '/api/auth/me');
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.user, null);
  requestIds.push(response.headers.get('x-request-id'));
}
assert.equal(hash(metadataPath), before.hash, 'Reads must not rewrite business metadata');
assert.equal(fs.statSync(metadataPath).mtimeMs, before.mtime, 'Reads must not save the business snapshot');
const snapshot = JSON.parse(fs.readFileSync('/app/storage/audit/snapshot.json','utf8'));
const journal = fs.readFileSync('/app/storage/audit/events.jsonl','utf8');
const evidence = JSON.stringify(snapshot) + journal;
assert.ok(requestIds.every(id => id && evidence.includes(id)), 'All verification reads must persist independent audit');
assert.equal(process.env.KUNQIONG_SCAN_MODE, 'required', 'Required scanning must stay enabled');
await new Promise((resolve,reject) => {
  const socket = net.connect(Number(process.env.KUNQIONG_CLAMAV_PORT || 3310), process.env.KUNQIONG_CLAMAV_HOST || '127.0.0.1');
  let body=''; socket.setTimeout(10000); socket.once('connect',()=>socket.write('zPING\\0'));
  socket.on('data',data=>{body+=data; if(body.includes('PONG')){socket.destroy();resolve();}});
  socket.once('error',reject); socket.once('timeout',()=>{socket.destroy();reject(new Error('Scanner timeout'));});
});
console.log(JSON.stringify({release:health.release,sourceFiles:Object.keys(manifest).length,pages:4,assets,workerAssets,avatarDecoder:'WebP 1x1; corrupt input rejected',auditStorage:stored.auditStorage,readRequests:requestIds.length,businessSnapshotUnchanged:true,auditRequestsPersisted:true,previousDataVerified:Boolean(previous),preservedCounts:previous?Object.fromEntries(Object.entries(previous).map(([kind,ids])=>[kind,ids.length])):null,scanner:'PONG',passed:true}));
`
const result = spawnSync('docker', ['exec', '-i', app, 'node', '--input-type=module'], { input: probe, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 ** 2 })
if (result.status !== 0) throw new Error(`Deployment verification failed (${result.status}): ${result.stderr || result.error?.message || ''}`)
console.log(result.stdout.trim())
