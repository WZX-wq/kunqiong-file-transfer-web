import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createScanCoordinator, scanFileBatch } from '../server/lib/scan-coordinator.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-scan-performance-'))
const safe = { reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: new Date().toISOString() }
const risk = () => Object.assign(new Error('文件扫描发现威胁，已阻止发布'), { status: 415, code: 'scan_threat_detected' })
let passed = 0
function check(name, value) { assert.ok(value, name); passed++; console.log('PASS ' + name) }
function file(name, content = name) { const target = path.join(directory, name); fs.writeFileSync(target, content); return target }
async function waitFor(predicate) { for (let n = 0; n < 300 && !predicate(); n++) await delay(10); assert.ok(predicate(), 'fixture must make progress') }
try {
  const a = file('a.bin', 'same content'), b = file('renamed.bin', 'same content')
  let calls = 0, clock = 0
  const block = createScanCoordinator({ scan: async () => { calls++; throw risk() }, now: () => clock, blockedTtlMs: 100 })
  await assert.rejects(block(a), { code: 'scan_threat_detected' })
  await assert.rejects(block(b), { code: 'scan_threat_detected', status: 415 })
  check('identical risky bytes are blocked after rename without a second scan', calls === 1)
  fs.writeFileSync(b, 'diff content')
  await assert.rejects(block(b), { code: 'scan_threat_detected' })
  check('changed bytes of the same length require another scan', calls === 2)
  clock = 101
  await assert.rejects(block(a), { code: 'scan_threat_detected' })
  check('risk cache expires', calls === 3)

  calls = 0
  const approve = createScanCoordinator({ scan: async () => { calls++; return safe } })
  await approve(a); await approve(a)
  check('previous approval never skips a fresh scan', calls === 2)
  for (const code of ['scan_timeout', 'scan_unavailable', 'scan_incomplete', 'scan_size_limit']) {
    calls = 0
    const flaky = createScanCoordinator({ scan: async () => { if (++calls === 1) throw Object.assign(new Error(code), { code }); return safe } })
    await assert.rejects(flaky(a), { code }); await flaky(a)
    check(`${code} is not cached or treated as approval`, calls === 2)
  }

  calls = 0
  const capped = createScanCoordinator({ scan: async () => { calls++; throw risk() }, maxBlockedEntries: 1 })
  for (const target of [a, b, a]) await assert.rejects(capped(target), { code: 'scan_threat_detected' })
  check('risk cache has a fixed memory bound', calls === 3)

  let release, started = 0
  const identical = file('copy.bin', 'same content')
  const shared = createScanCoordinator({ concurrency: 1, scan: async () => { started++; await new Promise(r => { release = r }); return safe } })
  const p1 = shared(a), p2 = shared(identical)
  await waitFor(() => started === 1); await delay(30); release()
  const [r1, r2] = await Promise.all([p1, p2])
  check('duplicate detection shares an active scan even with a single scanner slot', started === 1)
  check('callers receive independent verdict objects', r1 !== r2 && r1.reviewStatus === 'approved' && r2.reviewStatus === 'approved')

  let mutationStarted = false, finishMutation
  const mutable = file('mutable.bin')
  const mutation = createScanCoordinator({ scan: async () => { mutationStarted = true; await new Promise(r => { finishMutation = r }); return safe } })
  const changed = assert.rejects(mutation(mutable), { code: 'scan_file_changed' })
  await waitFor(() => mutationStarted); fs.writeFileSync(mutable, 'replacement with different size'); finishMutation(); await changed
  check('bytes modified during scanning cannot be approved', true)

  let running = 0, peak = 0
  const bounded = createScanCoordinator({ concurrency: 2, scan: async () => { running++; peak = Math.max(peak, running); await delay(80); running--; return safe } })
  await Promise.all(Array.from({ length: 6 }, (_, n) => bounded(file(`bounded-${n}`))))
  check('concurrent uploads never exceed two scanner jobs', peak === 2 && running === 0)

  const starts = [], releases = new Map()
  const mixed = createScanCoordinator({ concurrency: 3, largeConcurrency: 2, largeFileBytes: 16, scan: async target => {
    const name = path.basename(target); starts.push(name)
    await new Promise(resolve => releases.set(name, resolve)); return safe
  } })
  const largeJobs = Array.from({ length: 3 }, (_, n) => mixed(file(`large-${n}`, String(n).repeat(32))))
  await waitFor(() => starts.length === 2)
  check('large archives obey their separate cap', starts.length === 2)
  const short = mixed(file('short', 'ok'))
  await waitFor(() => starts.includes('short'))
  check('small file uses the spare slot instead of waiting behind large files', starts.length === 3 && starts.at(-1) === 'short')
  releases.get('short')(); await short
  releases.get(starts[0])()
  await waitFor(() => starts.filter(name => name.startsWith('large-')).length === 3)
  for (const release of releases.values()) release()
  await Promise.all(largeJobs)
  check('queued large files start as soon as a large slot is released', starts.filter(name => name.startsWith('large-')).length === 3)

  const scheduling = [], originalOrder = [{ name: 'large', size: 100 }, { name: 'small', size: 1 }]
  await scanFileBatch(originalOrder, async value => scheduling.push(value.name), { concurrency: 1 })
  check('batch checks smaller files first without changing publication order', scheduling.join(',') === 'small,large' && originalOrder[0].name === 'large')

  const inputs = Array.from({ length: 4 }, (_, n) => ({ name: `batch-${n}` }))
  const progress = [], work = async () => { await delay(100) }
  const serialStart = performance.now(); await scanFileBatch(inputs, work, { concurrency: 1 }); const serialMs = performance.now() - serialStart
  const parallelStart = performance.now(); await scanFileBatch(inputs, work, { concurrency: 2, onProgress: (f, i, state) => progress.push(state) }); const parallelMs = performance.now() - parallelStart
  check('batch progresses to all files complete', progress.at(-1).completedFileCount === 4 && progress.at(-1).activeFileCount === 0)
  check('batch reports actual parallel work', progress.some(p => p.activeFileCount === 2))
  check('two workers improve a controlled four-file workload', parallelMs < serialMs * 0.8)
  console.log(JSON.stringify({ fixture: 'four independent 100ms scanner jobs', serialMs: Math.round(serialMs), parallelMs: Math.round(parallelMs) }))

  let jobs = 0, settled = false
  await assert.rejects(scanFileBatch(inputs, async () => { if (++jobs === 1) throw risk(); await delay(40); settled = true }, { concurrency: 2 }), { code: 'scan_threat_detected' })
  check('failure stops queued files and waits for active scans before cleanup', jobs === 2 && settled)
  console.log(`Scan performance regression passed: ${passed} checks`)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
