import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const script = path.join(root, 'scripts/backup-test-deployment.sh')
const bash = process.env.BASH || (process.platform === 'win32'
  ? ['D:/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(candidate => fs.existsSync(candidate)) || 'bash'
  : 'bash')
const bashCheck = spawnSync(bash, ['--version'], { encoding: 'utf8', windowsHide: true })

test('test deployment skips the SQL dump but keeps a local metadata snapshot', { skip: bashCheck.status !== 0 }, t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-deploy-backup-'))
  const compose = path.join(fixture, 'compose')
  const bin = path.join(fixture, 'bin')
  fs.mkdirSync(compose); fs.mkdirSync(bin)
  for (const file of ['.env', 'docker-compose.test.yml', 'clamd.conf']) fs.writeFileSync(path.join(compose, file), 'fixture')
  const envFile = path.join(compose, '.env')
  const calls = path.join(fixture, 'docker-calls.log')
  const docker = path.join(bin, 'docker')
  fs.writeFileSync(docker, `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
if [[ "$1" == inspect ]]; then
  case "$*" in
    *".Image"*) printf 'sha256:previous-image\\n' ;;
    *"/app/storage"*) printf 'kunqiong-storage\\n' ;;
    *".State.Running"*) printf 'false\\n' ;;
    *".State.Paused"*) printf 'false\\n' ;;
  esac
fi
`)
  fs.chmodSync(docker, 0o755)
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))

  const result = spawnSync(bash, [script, 'kunqiong-file-transfer-web', compose, 'release-test', 'kunqiong-file-transfer-web:test', envFile], {
    encoding: 'utf8', windowsHide: true,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      DOCKER_CALL_LOG: calls,
      KUNQIONG_DEPLOY_SKIP_DATABASE_BACKUP: 'true',
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Database dump skipped by deployment configuration/)
  const dockerCalls = fs.readFileSync(calls, 'utf8')
  assert.doesNotMatch(dockerCalls, /backup-mysql\.mjs/)
  assert.match(dockerCalls, /KUNQIONG_DATABASE_BACKUP_STATUS=skipped_by_operator/)
  assert.ok(fs.existsSync(path.join(compose, '.last-deployment-backup')))
})
