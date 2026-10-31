// Exercise legacy-builder container labels, including the reset at each FROM.
// Use a cached shell-capable base via KUNQIONG_DEPLOY_PROBE_BASE when offline.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const app = 'kunqiong-file-transfer-web'
const source = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
const stages = source.split(/^FROM\s+/mi).slice(1)
assert.ok(stages.length > 0, 'Dockerfile must contain build stages')
const base = process.env.KUNQIONG_DEPLOY_PROBE_BASE || stages[0].trim().split(/\s+/)[0]
const image = app + ':project-probe-' + randomUUID()
const fixture = stages.map((stage, index) => {
  // Reuse the actual stage labels rather than giving the probe its own label.
  const beforeRun = stage.split(/^RUN\s+/mi)[0]
  const labels = beforeRun.match(/^LABEL\s+[^\r\n]+/gmi) || []
  return [`FROM ${base} AS probe${index}`, ...labels,
    `RUN echo kunqiong-project-probe-${index}`].join('\n')
}).join('\n')
const run = (args, options = {}) => spawnSync('docker', args, {
  encoding: 'utf8', windowsHide: true, timeout: 120000, ...options,
})
let containers = []
try {
  const build = run(['build', '--no-cache', '--rm=false', '-t', image, '-'], {
    input: fixture,
    env: { ...process.env, DOCKER_BUILDKIT: '0' },
  })
  const output = (build.stdout || '') + (build.stderr || '')
  containers = [...output.matchAll(/Running in ([a-f0-9]+)/g)].map(match => match[1])
  assert.equal(build.status, 0, 'Project identity probe build failed:\n' + output)
  assert.ok(containers.length > 0, 'Probe must exercise the legacy builder')
  let checked = 0
  for (const id of containers) {
    const inspection = run(['inspect', id])
    assert.equal(inspection.status, 0, 'Probe container must remain available for inspection')
    const info = JSON.parse(inspection.stdout)[0]
    if (!(info.Config.Cmd || []).some(arg => arg.includes('echo kunqiong-project-probe-'))) continue
    assert.equal(info.Config.Labels?.['com.docker.compose.project'], app,
      `Build stage ${checked} must be recognized as ${app} by the server guard`)
    checked++
  }
  assert.equal(checked, stages.length, 'Every build stage must be checked')
  console.log(`PASS ${checked} legacy Docker build stages retain project ${app}`)
} finally {
  // Only remove containers and the image created by this isolated probe.
  if (containers.length) run(['rm', '-f', ...containers])
  run(['image', 'rm', image])
}
