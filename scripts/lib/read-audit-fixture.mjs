// Read-only evidence reader for isolated JSON fixtures (including independent audit storage).
import fs from 'node:fs'
import path from 'node:path'
import { MAX_AUDIT_LOGS } from '../../server/config.js'
import { mergeAuditEntries } from '../../server/lib/audit-store.js'

export function readFixtureMetadata(filename, options = {}) {
  const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const directory = path.join(path.dirname(filename), 'audit')
  if (!fs.existsSync(path.join(directory, 'snapshot.json'))) {
    if (options.normalize && Array.isArray(metadata.auditLogs)) {
      metadata.auditLogs = mergeAuditEntries(metadata.auditLogs, options.normalize, options.limit ?? MAX_AUDIT_LOGS)
    }
    return metadata
  }
  const snapshot = JSON.parse(fs.readFileSync(path.join(directory, 'snapshot.json'), 'utf8'))
  const journal = fs.readFileSync(path.join(directory, 'events.jsonl'))
  return restoreFixtureAudit(metadata, snapshot, journal, options)
}

export function listValidAuditIds(entries, normalize) {
  const ids = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!String(entry?.id || '').trim()) continue
    const log = normalize(entry)
    if (log?.id && log.action) ids.add(String(log.id))
  }
  return [...ids]
}

export function restoreFixtureAudit(metadata, snapshot, journal, { normalize, limit = MAX_AUDIT_LOGS } = {}) {
  const headerEnd = journal.indexOf(10) + 1
  const header = JSON.parse(journal.subarray(0, headerEnd).toString())
  const offset = header.journalId === snapshot.appliedJournalId ? Math.max(headerEnd, snapshot.appliedJournalOffset) : headerEnd
  const completeEnd = journal.lastIndexOf(10) + 1
  const appended = journal.subarray(offset, completeEnd).toString().split('\n').filter(Boolean).map(row => JSON.parse(row))
  const rows = new Map(snapshot.logs.map(row => [row.id, row]))
  for (const row of appended) rows.set(row.id, row)
  metadata.auditLogs = normalize
    ? mergeAuditEntries([...rows.values()], normalize, limit)
    : [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_AUDIT_LOGS)
  return metadata
}
