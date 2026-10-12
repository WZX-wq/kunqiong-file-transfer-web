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
let passed = 0, failures = []
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
