// Opt-in scanner load probe. Generates harmless bytes; creates no shares/users.
// KUNQIONG_CLAMAV_HOST=scanner node scripts/benchmark-scanner.mjs
import crypto from 'node:crypto'
import net from 'node:net'
import { once } from 'node:events'

const host = process.env.KUNQIONG_CLAMAV_HOST || '127.0.0.1'
const port = Number(process.env.KUNQIONG_CLAMAV_PORT || 3310)
const mib = Math.min(256, Math.max(1, Number(process.env.SCAN_BENCH_MIB) || 64))
const jobs = Math.min(32, Math.max(4, Math.floor(Number(process.env.SCAN_BENCH_JOBS) || 8)))
const rounds = [1, 2, 3, 4, 3, 2, 4, 2, 3]

async function scan() {
  const started = performance.now(), socket = net.createConnection({ host, port })
  let response = ''
  const timer = setTimeout(() => socket.destroy(new Error('Scanner benchmark exceeded 90 seconds')), 90_000)
  const verdict = new Promise((resolve, reject) => {
    socket.on('error', reject)
    socket.on('close', () => { if (!response.includes('\0')) reject(new Error('Incomplete scanner verdict')) })
    socket.on('data', data => {
      response += data
      if (response.length > 4096) return socket.destroy(new Error('Invalid scanner response'))
      if (response.includes('\0')) {
        const result = response.split('\0')[0]
        if (result === 'stream: OK') resolve()
        else reject(new Error(result))
      }
    })
  })
  const producer = (async () => {
    await once(socket, 'connect')
    const write = async data => { if (!socket.write(data)) await once(socket, 'drain') }
    await write(Buffer.from('zINSTREAM\0'))
    // Different bytes each time avoid ClamAV's clean-file cache distorting results.
    const cipher = crypto.createCipheriv('aes-256-ctr', crypto.randomBytes(32), crypto.randomBytes(16))
    const zeros = Buffer.alloc(1024 * 1024), header = Buffer.alloc(4)
    const bytes = Math.floor(mib * 1024 * 1024)
    for (let offset = 0; offset < bytes; offset += zeros.length) {
      const block = cipher.update(zeros.subarray(0, Math.min(zeros.length, bytes - offset)))
      header.writeUInt32BE(block.length)
      await write(header); await write(block)
    }
    await write(Buffer.alloc(4))
  })()
  try { await Promise.all([verdict, producer]); return performance.now() - started }
  finally { clearTimeout(timer); socket.destroy() }
}

for (const [round, concurrency] of rounds.entries()) {
  const started = performance.now(), latencies = []
  let next = 0, error
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!error && next++ < jobs) {
      try { latencies.push(await scan()) } catch (caught) { error ||= caught }
    }
  }))
  if (error) throw error
  const totalMs = performance.now() - started
  latencies.sort((a, b) => a - b)
  console.log(JSON.stringify({ round: round + 1, concurrency, jobs, bytesPerFile: Math.floor(mib * 1024 ** 2), totalMs: Math.round(totalMs), throughputMiBps: Number((mib * jobs / (totalMs / 1000)).toFixed(2)), p50Ms: Math.round(latencies[Math.ceil(jobs / 2) - 1]), maxMs: Math.round(latencies.at(-1)) }))
}
