export const REQUIRED_MIGRATIONS = [
  '001-existing-features-relational-schema',
  '002-relational-runtime-payloads',
  '003-upload-session-storage',
  '005-on-demand-resource-usage',
  '006-normalized-entities-and-cleanup',
  '007-pagination-indexes',
  '008-record-list-projection',
]

export function missingMigrationKeys(appliedKeys, requiredKeys = REQUIRED_MIGRATIONS) {
  const applied = new Set(appliedKeys)
  return requiredKeys.filter(key => !applied.has(key))
}
