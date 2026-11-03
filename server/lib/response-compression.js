import compression from 'compression'

// MIT expressjs/compression handles negotiation, Vary, ETag and streaming safely.
export const responseCompression = () => compression({
  threshold: 1024,
  filter(req, res) {
    if (/attachment/i.test(res.getHeader('Content-Disposition') || '') || /\/(download|files)(?:\/|$)/.test(req.path)) return false
    return compression.filter(req, res)
  },
})
