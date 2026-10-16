import crypto from 'node:crypto'
import fs from 'node:fs'

// Only blocked verdicts are retained. A previous approval can never bypass a
// fresh scan after a database/configuration change or scanner outage.
export function createScanCoordinator({ scan, concurrency = 3, largeConcurrency = Math.min(2, concurrency), largeFileBytes = 128 * 1024 * 1024, blockedTtlMs = 5 * 60_000, maxBlockedEntries = 128, now = Date.now }) {
  const blocked = new Map()
  const active = new Map()
  let running = 0, largeRunning = 0, hashing = 0
  const waiting = []
  const hashWaiting = []
  // Large archive jobs have their own cap. Select the oldest eligible job so
  // waiting large files do not prevent small files from using a free slot.
  function drain() {
    while (running < concurrency) {
      const index = waiting.findIndex(job => !job.large || largeRunning < largeConcurrency)
      if (index < 0) return
      const job = waiting.splice(index, 1)[0]
      running++; if (job.large) largeRunning++
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
        running--; if (job.large) largeRunning--; drain()
      })
    }
  }
  function limited(work, size) {
    return new Promise((resolve, reject) => {
      waiting.push({ work, resolve, reject, large: size >= largeFileBytes }); drain()
    })
  }
  // Hashing is bounded separately: a long scan must not block identifying a
  // short file or recognizing content already being scanned.
  async function hashLimited(work) {
    if (hashing >= 2) await new Promise(resolve => hashWaiting.push(resolve))
    else hashing++
    try { return await work() }
    finally { const next = hashWaiting.shift(); if (next) next(); else hashing-- }
  }
  const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
  function changed() {
    return Object.assign(new Error('文件在安全检查期间发生变化，请重新上传'), { status: 409, code: 'scan_file_changed' })
  }
  async function identity(filePath) {
    return hashLimited(async () => {
      const before = await fs.promises.stat(filePath)
      if (!before.isFile()) throw changed()
      const digest = crypto.createHash('sha256')
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) digest.update(chunk)
      if (stamp(before) !== stamp(await fs.promises.stat(filePath))) throw changed()
      return { key: `${before.size}:${digest.digest('hex')}`, stamp: stamp(before), size: before.size }
    })
  }
  return async function scanFile(filePath) {
    const file = await identity(filePath)
    for (const [key, entry] of blocked) if (entry.expires <= now()) blocked.delete(key)
    const cached = blocked.get(file.key)
    if (cached) throw Object.assign(new Error(cached.message), { status: 415, code: 'scan_threat_detected', ...(cached.scanFinding ? { scanFinding: { ...cached.scanFinding } } : {}) })
    let job = active.get(file.key)
    if (!job) {
      job = limited(async () => {
        if (file.stamp !== stamp(await fs.promises.stat(filePath))) throw changed()
        try {
          const result = await scan(filePath)
          if (file.stamp !== stamp(await fs.promises.stat(filePath))) throw changed()
          return result
        } catch (error) {
          if (error.code === 'scan_threat_detected' && file.stamp === stamp(await fs.promises.stat(filePath))) {
            blocked.set(file.key, { message: error.message, ...(error.scanFinding ? { scanFinding: { ...error.scanFinding } } : {}), expires: now() + blockedTtlMs })
            while (blocked.size > maxBlockedEntries) blocked.delete(blocked.keys().next().value)
          }
          throw error
        }
      }, file.size).finally(() => active.delete(file.key))
      active.set(file.key, job)
    }
    const result = await job
    if (file.stamp !== stamp(await fs.promises.stat(filePath))) throw changed()
    return { ...result }
  }
}

// Stop scheduling on a failure, but wait for files already being scanned before
// callers clean up the batch's temporary directory.
export async function scanFileBatch(files, scan, { concurrency = 3, onProgress } = {}) {
  let next = 0, completed = 0, failure
  const active = new Map()
  const report = () => {
    const current = active.entries().next().value
    onProgress?.(current?.[1], current?.[0] ?? 0, { completedFileCount: completed, activeFileCount: active.size })
  }
  const ordered = files.map((file, index) => ({ file, index }))
    .sort((a, b) => Number(a.file.size || 0) - Number(b.file.size || 0))
  async function worker() {
    while (!failure && next < files.length) {
      const { index, file } = ordered[next++]
      active.set(index, file); report()
      try { await scan(file); completed++ }
      catch (error) { failure ||= error }
      finally { active.delete(index); report() }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  if (failure) throw failure
}
