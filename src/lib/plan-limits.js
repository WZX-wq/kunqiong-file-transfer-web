// Keep the effective server limit selectable even when it is not a preset.
export function collectionSizeOptions(maxMb = 1228, currentMb = 0) {
  const limit = Math.max(1, Math.floor(Number(maxMb) || 1228))
  return [...new Set([500, 1024, 2048, 5120, 10240, 15360, 20480, limit, Number(currentMb)])]
    .filter(value => value > 0 && value <= limit).sort((a, b) => a - b)
}
