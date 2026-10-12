import assert from 'node:assert/strict'
import sharp from 'sharp'
import { normalizeAvatarData } from '../server/lib/avatar-validation.js'

let checks = 0
const uri = (format, bytes) => `data:image/${format};base64,${bytes.toString('base64')}`
async function rejects(value, label) {
  await assert.rejects(normalizeAvatarData(value), (error) => error.status === 400 && /头像/.test(error.message), label)
  checks += 1
}
async function accepts(value, width, height, label) {
  const result = await normalizeAvatarData(value)
  assert.match(result, /^data:image\/webp;base64,/)
  assert.ok(Buffer.byteLength(result, 'utf8') <= 600000)
  const bytes = Buffer.from(result.split(',')[1], 'base64')
  const { info } = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true })
  const metadata = await sharp(bytes).metadata()
  assert.equal(info.width, width, `${label}: width`)
  assert.equal(info.height, height, `${label}: height`)
  assert.equal(metadata.exif, undefined, `${label}: source EXIF must not be retained`)
  assert.equal(metadata.orientation, undefined, `${label}: pixel orientation is normalized`)
  checks += 1
}
const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#cc3377' } }).png().toBuffer()
const forgedPng = Buffer.alloc(45)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(forgedPng)
forgedPng.write('IEND', forgedPng.length - 8)
await rejects(uri('png', forgedPng), 'A PNG signature and IEND marker cannot stand in for a decodable image')
await accepts(uri('png', png), 1, 1, 'Genuine 1x1 PNG')
for (const format of ['jpeg', 'webp', 'gif']) {
  const bytes = await sharp(png).toFormat(format).toBuffer()
  await accepts(uri(format, bytes), 1, 1, `Genuine ${format}`)
}
const jpg = await sharp(png).jpeg().toBuffer()
await accepts(uri('jpg', jpg), 1, 1, 'JPEG alias')
await accepts(uri('PNG', png), 1, 1, 'Case-insensitive declared MIME')
const oriented = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#f00' } })
  .withMetadata({ orientation: 6 }).jpeg().toBuffer()
await accepts(uri('jpeg', oriented), 4, 8, 'EXIF orientation is applied before stripping metadata')
await rejects(uri('jpeg', png), 'Declared MIME must match decoded image format')
await rejects(uri('png', Buffer.from('not an image')), 'Arbitrary bytes')
await rejects(uri('png', png.subarray(0, -15)), 'Truncated PNG')
const corruptPng = Buffer.from(png)
const idat = corruptPng.indexOf(Buffer.from('IDAT'))
corruptPng[idat + 6] ^= 255
await rejects(uri('png', corruptPng), 'PNG with corrupt compressed image data')
await rejects(`data:image/png;base64,${png.toString('base64')}\n`, 'Base64 whitespace')
await rejects('data:image/png;base64,Zh==', 'Non-canonical base64 pad bits')
await rejects('data:image/svg+xml;base64,PHN2Zy8+', 'SVG unsupported')
await rejects(`data:image/png;base64,${'A'.repeat(600000)}`, 'Data URI byte cap')
for (const value of [null, false, 12, [], {}, undefined]) await rejects(value, 'Non-string avatar')
assert.equal(await normalizeAvatarData(''), '', 'Explicit empty string preserves restore-avatar operation')
checks += 1
for (const [width, height] of [[4097, 1], [1, 4097], [4001, 4000]]) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#fff' } }).png().toBuffer()
  await rejects(uri('png', bytes), `Oversized dimensions ${width}x${height}`)
}
const boundedImage = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer()
await accepts(uri('png', boundedImage), 512, 512, 'Exactly 16 million pixels is accepted and resized')
const wideImage = await sharp({ create: { width: 4096, height: 2048, channels: 3, background: '#fff' } }).png().toBuffer()
await accepts(uri('png', wideImage), 512, 256, 'Maximum width with aspect ratio preserved')
const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
  raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
}).gif({ delay: [100, 100], loop: 0 }).toBuffer()
await rejects(uri('gif', animated), 'Multi-frame GIF must not become an arbitrary static frame')
const animatedWebp = await sharp(animated, { animated: true }).webp().toBuffer()
await rejects(uri('webp', animatedWebp), 'Multi-frame WebP')

// A genuine two-frame APNG: PNG decoders can silently return the first frame
// without reporting pages, so it needs an independent animation fixture.
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of payload) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length)
  payload.copy(result, 4)
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}
function imageChunks(bytes) {
  const chunks = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    chunks.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, offset + 8 + length) })
    offset += length + 12
  }
  return chunks
}
function frameControl(sequence) {
  const control = Buffer.alloc(26)
  control.writeUInt32BE(sequence)
  control.writeUInt32BE(1, 4)
  control.writeUInt32BE(1, 8)
  control.writeUInt16BE(1, 20)
  control.writeUInt16BE(10, 22)
  return control
}
const pngChunks = imageChunks(png)
const secondFrame = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#00aa00' } }).png().toBuffer()
const animationControl = Buffer.alloc(8)
animationControl.writeUInt32BE(2)
const sequence = Buffer.alloc(4)
sequence.writeUInt32BE(2)
const apng = Buffer.concat([
  png.subarray(0, 8), chunk('IHDR', pngChunks.find((entry) => entry.type === 'IHDR').data),
  chunk('acTL', animationControl), chunk('fcTL', frameControl(0)),
  ...pngChunks.filter((entry) => entry.type === 'IDAT').map((entry) => chunk('IDAT', entry.data)),
  chunk('fcTL', frameControl(1)),
  chunk('fdAT', Buffer.concat([sequence, ...imageChunks(secondFrame).filter((entry) => entry.type === 'IDAT').map((entry) => entry.data)])),
  chunk('IEND', Buffer.alloc(0)),
])
await rejects(uri('png', apng), 'APNG animation cannot be silently flattened')
console.log(`Avatar boundary checks passed: ${checks}`)
