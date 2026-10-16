// 浏览器偶发把 UTF-8 文件名按 latin1 上报（表现为「ä½ å¥½.txt」这类乱码），
// 检出这种特征时按 latin1→utf8 还原；无法还原则原样返回。
export function normalizeUploadFileName(value = '', { trim = true } = {}) {
  const text = String(value || '')
  const raw = trim ? text.trim() : text
  if (!raw) return raw
  const decoded = Buffer.from(raw, 'latin1').toString('utf8')
  if (decoded && decoded !== raw && !decoded.includes('\uFFFD') && looksLikeMojibake(raw)) return decoded
  return raw
}

export function looksLikeMojibake(value = '') {
  return /(?:Ã|Â|Ä|Å|Æ|Ç|È|É|Ê|Ë|Ì|Í|Î|Ï|Ð|Ñ|Ò|Ó|Ô|Õ|Ö|Ø|Ù|Ú|Û|Ü|Ý|Þ|ß|à|á|â|ã|ä|å|æ|ç|è|é|ê|ë|ì|í|î|ï|ð|ñ|ò|ó|ô|õ|ö|ø|ù|ú|û|ü|ý|þ|ÿ)/.test(String(value))
}
