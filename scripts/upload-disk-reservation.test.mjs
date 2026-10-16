import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  assertPhysicalUploadCapacity,
  discardUploadSession,
  pendingPhysicalUploadBytes,
  reserveUploadDisk,
  releaseUploadDiskReservation,
} from '../server/services/shares.js'
import { uploadDiskReservations, uploadIntakeReservations, uploadSessions } from '../server/state.js'

const headroom = 64 * 1024 ** 2
const session = (id, bytes) => ({
  id,
  files: [{ size: bytes }],
  directory: fs.mkdtempSync(path.join(os.tmpdir(), `kunqiong-upload-disk-${id}-`)),
})

test.afterEach(() => {
  for (const item of uploadSessions.values()) {
    if (item.id?.startsWith('disk-test-')) discardUploadSession(item)
  }
  for (const id of [...uploadDiskReservations.keys()]) {
    if (id.startsWith('disk-test-')) releaseUploadDiskReservation(id)
  }
})

test('session reservations include all unfinished target bytes and release on cancellation', () => {
  const first = session('disk-test-first', 128 * 1024 ** 2)
  const second = session('disk-test-second', 128 * 1024 ** 2)
  reserveUploadDisk(first, { availableBytes: first.files[0].size + headroom })
  assert.equal(pendingPhysicalUploadBytes(), first.files[0].size)
  assert.throws(
    () => reserveUploadDisk(second, { availableBytes: second.files[0].size + headroom }),
    error => error.status === 507,
  )
  uploadSessions.set(first.id, first)
  discardUploadSession(first)
  assert.equal(pendingPhysicalUploadBytes(), 0)
})

test('physical capacity check excludes the session being revalidated', () => {
  const item = session('disk-test-revalidate', 128 * 1024 ** 2)
  reserveUploadDisk(item, { availableBytes: item.files[0].size + headroom })
  assert.doesNotThrow(() => assertPhysicalUploadCapacity(item, item.id, headroom + item.files[0].size))
  releaseUploadDiskReservation(item.id)
})

test('direct intake and resumable sessions share the same physical budget', () => {
  const request = {}
  const item = session('disk-test-intake', 128 * 1024 ** 2)
  uploadIntakeReservations.set(request, 64 * 1024 ** 2)
  try {
    assert.equal(pendingPhysicalUploadBytes(), 64 * 1024 ** 2)
    assert.throws(() => reserveUploadDisk(item, { availableBytes:item.files[0].size + headroom }), error => error.status === 507)
  } finally { uploadIntakeReservations.delete(request) }
  assert.doesNotThrow(() => reserveUploadDisk(item, { availableBytes:item.files[0].size + headroom }))
})
