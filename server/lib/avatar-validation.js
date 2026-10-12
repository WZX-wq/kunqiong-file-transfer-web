import sharp from 'sharp'
import { httpError } from './http.js'

const MAX_DATA_URI_BYTES = 600000
const MAX_DIMENSION = 4096
const MAX_PIXELS = 16_000_000
const OUTPUT_DIMENSION = 512

function containsAnimatedPng(bytes) {
  // PNG animation control lives in a real chunk, not an arbitrary byte sequence
  // inside compressed pixels. libpng can otherwise silently decode just frame 1.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset)
    if (size > bytes.length - offset - 12) break
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return true
    offset += size + 12
  }
  return false
}

/** Decode untrusted avatars fully, remove metadata, and store a bounded static image. */
export async function normalizeAvatarData(value) {
  if (value === '') return ''
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DATA_URI_BYTES) {
    throw httpError(400, '头像格式不支持或图片过大，请上传 600 KB 以内的图片')
  }
  const match = value.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i)
  if (!match) throw httpError(400, '头像格式不支持，请上传 PNG、JPEG、WebP 或 GIF 图片')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.toString('base64') !== match[2]) throw httpError(400, '头像数据格式错误，请重新选择图片')
  const format = match[1].toLowerCase().replace('jpg', 'jpeg')
  const options = { failOn: 'warning', limitInputPixels: MAX_PIXELS }
  try {
    const image = sharp(bytes, options)
    const metadata = await image.metadata()
    if (metadata.format !== format) throw httpError(400, '头像实际格式与声明不一致，请重新选择图片')
    if ((metadata.pages || 1) !== 1 || (format === 'png' && containsAnimatedPng(bytes))) {
      throw httpError(400, '头像不支持动画，请上传静态图片')
    }
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1
      || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS) {
      throw httpError(400, '头像尺寸过大，请上传宽高不超过 4096 像素且总像素不超过 1600 万的图片')
    }
    // Decode before resizing so truncated/corrupt pixels cannot escape validation
    // through decoder shrink-on-load. The source pixel limit bounds this buffer.
    const decoded = await image.autoOrient().raw().toBuffer({ resolveWithObject: true })
    const encoded = await sharp(decoded.data, { raw: decoded.info })
      .resize(OUTPUT_DIMENSION, OUTPUT_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer()
    const normalized = `data:image/webp;base64,${encoded.toString('base64')}`
    if (Buffer.byteLength(normalized, 'utf8') > MAX_DATA_URI_BYTES) {
      throw httpError(400, '头像图片过大，请重新选择较小的图片')
    }
    return normalized
  } catch (error) {
    if (error.status === 400) throw error
    throw httpError(400, '头像图片损坏或尺寸过大，请重新选择有效图片')
  }
}
