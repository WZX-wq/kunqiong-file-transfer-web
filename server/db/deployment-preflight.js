export function shouldSkipRelationalSchemaPreflight({ appliedMigrations, expectedMigrations, hasRelationalState }) {
  return Boolean(hasRelationalState)
    && Object.entries(expectedMigrations).every(([key, checksum]) => appliedMigrations[key] === checksum)
}
