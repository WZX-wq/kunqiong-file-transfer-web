export async function readTextPreview(response, limit, signal) {
  if (!response.body?.getReader) throw new Error('浏览器不支持安全的文本预览，请下载后查看')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  const abort = () => { reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once:true })
  try {
    while (size <= limit) {
      if (signal?.aborted) throw new DOMException('预览已取消', 'AbortError')
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new DOMException('预览已取消', 'AbortError')
      if (done) break
      const part = value.subarray(0, limit + 1 - size)
      chunks.push(part)
      size += part.length
    }
    const result = new Uint8Array(Math.min(size, limit))
    let offset = 0
    for (const part of chunks) {
      const retained = part.subarray(0, result.length - offset)
      result.set(retained, offset)
      offset += retained.length
    }
    const rangeTotal = Number(response.headers.get('content-range')?.split('/')[1])
    const total = rangeTotal || Number(response.headers.get('content-length'))
    return { content:new TextDecoder().decode(result), truncated:size > limit || total > limit }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
