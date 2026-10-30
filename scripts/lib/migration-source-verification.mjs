export function classifyMigrationSource(receipt, backupCompletedAt) {
  // A retry may see a newer backup while the database keeps its original migration receipt.
  const importedAt = Date.parse(receipt?.completedAt)
  const backupAt = Date.parse(backupCompletedAt)
  if (!Number.isFinite(importedAt) || !Number.isFinite(backupAt)) return 'unverifiable'
  return importedAt > backupAt ? 'current-deployment' : 'previously-migrated'
}
