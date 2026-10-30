export function classifyMigrationSource(receipt, backupCompletedAt) {
  // A retry may see a newer backup while the database keeps its original migration receipt.
  const importedAt = Date.parse(receipt?.completedAt)
  const backupAt = Date.parse(backupCompletedAt)
  if (!Number.isFinite(importedAt) || !Number.isFinite(backupAt)) return 'unverifiable'
  return importedAt > backupAt ? 'current-deployment' : 'previously-migrated'
}

export function hasValidImportedCountManifest(importedCounts, currentCounts) {
  if (!importedCounts || typeof importedCounts !== 'object' || Array.isArray(importedCounts)) return false
  if (!currentCounts || typeof currentCounts !== 'object' || Array.isArray(currentCounts)) return false
  const currentTables = new Set(Object.keys(currentCounts))
  const importedEntries = Object.entries(importedCounts)
  return importedEntries.length > 0 && importedEntries.every(([table, count]) => currentTables.has(table)
    && Number.isSafeInteger(count) && count >= 0)
}
