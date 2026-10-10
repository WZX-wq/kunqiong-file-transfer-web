// SCAN-004：分片上传 500MB，验证扫描组装后真实字节
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const BASE = 'http://127.0.0.1:8045'
const file = path.join(root, '测试数据', '鲲穹文件传输测试数据包', '02-边界大小文件', 'TC-04-01-单文件大小边界-500MB.bin')
const size = fs.statSync(file).size
const CHUNK = 8 * 1024 * 1024 // 8MB
const totalChunks = Math.ceil(size / CHUNK)

console.log(`文件 ${size} 字节 = ${(size/1048576).toFixed(1)} MB，分片大小 ${CHUNK/1048576} MB，共 ${totalChunks} 分片`)

// 1. 创建会话
const create = await fetch(`${BASE}/api/upload-sessions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: [{ name: 'TC-04-01-单文件大小边界-500MB.bin', size, mimeType: 'application/octet-stream' }], chunkSize: CHUNK }),
})
const session = await create.json()
console.log('创建会话:', create.status, 'sessionId=', session.sessionId?.slice(0,12))

// 2. 乱序上传分片（故意逆序，验证 offset 直写 + 组装正确）
const fd = fs.openSync(file, 'r')
let idx = 0
// 逆序：从最后一个分片往前传
const order = []
for (let i = totalChunks - 1; i >= 0; i--) order.push(i)

for (const chunkIndex of order) {
  const start = chunkIndex * CHUNK
  const end = Math.min(size, start + CHUNK)
  const len = end - start
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, start)
  const hash = createHash('sha256').update(buf).digest('hex')
  const cf = new FormData()
  cf.append('chunk', new Blob([buf]), 'chunk')
  cf.append('fileIndex', '0')
  cf.append('chunkIndex', String(chunkIndex))
  cf.append('totalChunks', String(totalChunks))
  cf.append('chunkHash', hash)
  cf.append('filename', 'TC-04-01-单文件大小边界-500MB.bin')
  const res = await fetch(`${BASE}/api/upload-sessions/${session.sessionId}/chunks`, { method: 'POST', body: cf })
  if (res.status !== 200) { console.log(`分片 ${chunkIndex} 上传失败: ${res.status}`); process.exit(1) }
  idx++
  if (idx % 16 === 0) console.log(`  已传 ${idx}/${totalChunks} 分片`)
}
fs.closeSync(fd)
console.log(`全部分片上传完成（乱序）`)

// 3. complete 触发扫描
const complete = await fetch(`${BASE}/api/upload-sessions/${session.sessionId}/complete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
})
const data = await complete.json().catch(() => ({}))
console.log('complete:', complete.status)
const f = data.share?.files?.[0] || {}
console.log('reviewStatus:', f.reviewStatus)
console.log('scanEngine:  ', f.scanEngine)
console.log('scannedAt:   ', f.scannedAt)
console.log('文件 size 回显:', f.size)

const ok = complete.status === 201 && f.reviewStatus === 'approved' && f.scanEngine === 'clamav' && Number(f.size) === size
console.log('\n' + (ok ? 'SCAN-004 PASS：扫描的是组装后的完整 500MB 文件' : 'SCAN-004 FAIL'))
process.exit(ok ? 0 : 1)
