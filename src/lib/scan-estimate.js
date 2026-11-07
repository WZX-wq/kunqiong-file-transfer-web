// Planning estimate only. Archives and scanner queue load are unbounded by the
// compressed byte size, so never render this as a countdown or promise.
export function estimateScanWait(files = []) {
  const bytes = files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0)
  const archive = files.some(file => /\.(?:zip|rar|7z|tar|gz|exe|msi)$/i.test(file.name || ''))
  const seconds = Math.max(5, Math.ceil(bytes / (6 * 1024 ** 2)))
  const upper = Math.max(30, seconds * (archive ? 10 : 3))
  const format = value => value < 60 ? `${value} 秒` : `${Math.ceil(value / 60)} 分钟`
  return `预计 ${format(seconds)} 至 ${format(upper)}，仅供参考；压缩包内容、文件数量和服务器负载可能使耗时更长`
}
