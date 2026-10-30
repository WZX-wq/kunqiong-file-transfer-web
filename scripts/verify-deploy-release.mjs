// Exercise deployment's real runtime release gate with a local mocked Docker command.
// Ubuntu is only a Bash runtime; no production deployment or credentials are loaded.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-release-'))
const source = fs.readFileSync(path.join(root, 'scripts/deploy-test.sh'), 'utf8').replaceAll('\r', '')
const gate = source.slice(source.indexOf('  # 校验：运行中的容器 release'), source.indexOf('\n}\n\ncopy_to_deploy_dir()'))
if (!gate || !gate.includes('running_release')) throw Error('Runtime release gate not found')
const preserveConfig = source.slice(source.indexOf('preserve_existing_config()'), source.indexOf('\n\nnormalize_gitea_env_values()'))
if (!preserveConfig || !preserveConfig.includes('container_env')) throw Error('Existing container configuration fallback not found')
fs.writeFileSync(path.join(fixture, 'test.sh'), `#!/usr/bin/env bash
set -u
APP_NAME=fixture
PORT=8045
RELEASE_SHA=abcdef0123456789abcdef0123456789abcdef01
docker() { printf '%s' "$FIXTURE_RELEASE"; }
healthcheck_docker() { return "$FIXTURE_HEALTH_STATUS"; }
runtime_gate() {
${gate}
}
runtime_gate
`)
fs.writeFileSync(path.join(fixture, 'config-fallback.sh'), `#!/usr/bin/env bash
set -euo pipefail
APP_NAME=fixture
COMPOSE_DIR=/fixture/no-compose-env
DEPLOY_DIR=/fixture/no-deploy-env
docker() { printf '%s\\n' "$FIXTURE_CONTAINER_ENV"; }
KUNQIONG_DB_HOST=
KUNQIONG_DB_NAME=workflow-db
KUNQIONG_DB_PASSWORD=
KUNQIONG_DB_PORT=
${preserveConfig}
preserve_existing_config
[[ "$KUNQIONG_DB_HOST" == 'db.internal' ]]
[[ "$KUNQIONG_DB_NAME" == 'workflow-db' ]]
[[ "$KUNQIONG_DB_PASSWORD" == 'container-secret-sentinel' ]]
[[ "$KUNQIONG_DB_PORT" == '3307' ]]
`)
let passed = 0, failures = []
const configResult = spawnSync('docker', ['run', '--rm', '-v', fixture.replaceAll('\\', '/') + ':/fixture:ro', '-e', 'FIXTURE_CONTAINER_ENV=KUNQIONG_DB_HOST=db.internal\nKUNQIONG_DB_NAME=old-db\nKUNQIONG_DB_PASSWORD=container-secret-sentinel\nKUNQIONG_DB_PORT=3307', 'ubuntu:24.04', 'bash', '/fixture/config-fallback.sh'], { encoding: 'utf8', windowsHide: true })
if (configResult.status === 0 && !`${configResult.stdout}${configResult.stderr}`.includes('container-secret-sentinel')) {
  passed++; console.log('PASS missing deployment secrets inherit current container values without logging them')
} else {
  failures.push({ label: 'existing container configuration fallback', actual: configResult.status, output: configResult.stdout + configResult.stderr })
  console.log('FAIL existing container configuration fallback')
}
for (const item of [
  { label: 'exact deployed release succeeds', release: 'abcdef0123456789abcdef0123456789abcdef01', health: 0, expected: 0 },
  { label: 'different release is rejected', release: 'wrong-release', health: 0, expected: 1 },
  { label: 'same prefix but different commit is rejected', release: 'abcdef0123456789abcdef0123456789abcdef02', health: 0, expected: 1 },
  { label: 'missing release is rejected', release: '', health: 0, expected: 1 },
  { label: 'unhealthy app is rejected', release: 'abcdef0123456789abcdef0123456789abcdef01', health: 1, expected: 1 },
]) {
  const result = spawnSync('docker', ['run', '--rm', '-v', fixture.replaceAll('\\', '/') + ':/fixture:ro', '-e', 'FIXTURE_RELEASE=' + item.release, '-e', 'FIXTURE_HEALTH_STATUS=' + item.health, 'ubuntu:24.04', 'bash', '/fixture/test.sh'], { encoding: 'utf8', windowsHide: true })
  if (result.status === item.expected) { passed++; console.log('PASS ' + item.label) }
  else { failures.push({ label: item.label, actual: result.status, expected: item.expected, output: result.stdout + result.stderr }); console.log('FAIL ' + item.label) }
}
const result = { executedAt: new Date().toISOString(), passed, failures }
if (process.env.ACCEPTANCE_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.ACCEPTANCE_EVIDENCE_DIR, 'deploy-release-results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2)); process.exitCode = failures.length ? 1 : 0
