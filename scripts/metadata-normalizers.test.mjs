import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeAccountUser, normalizeAccountUserStore } from '../server/lib/metadata-normalizers.js'

test('startup account and session normalization preserves persisted updatedAt', () => {
  const updatedAt = '2026-10-20T08:30:00.000Z'
  const user = { id: 'user-1', username: 'user-1', nickname: 'User', updatedAt }
  const sessions = [{ id: 'session-1', user: { ...user } }]
  const users = normalizeAccountUserStore({ 'user-1': user }, sessions)

  assert.equal(users['user-1'].updatedAt, updatedAt)
  assert.equal(sessions[0].user.updatedAt, updatedAt)
})

test('a business account merge still refreshes updatedAt', () => {
  const user = { id: 'user-1', username: 'user-1', nickname: 'Before', updatedAt: '2026-10-20T08:30:00.000Z' }
  const merged = mergeAccountUser(user, { ...user, nickname: 'After' })

  assert.equal(merged.nickname, 'After')
  assert.notEqual(merged.updatedAt, user.updatedAt)
})
