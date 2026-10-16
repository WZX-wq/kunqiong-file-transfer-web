import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withFileLock } from '../server/lib/file-lock.js'

// 锁只在同步落盘期间短暂持有，残留锁必须能被回收，否则写盘会一路超时并让服务进入
// 「只读不可写」状态（所有 /api/* 返回 503）。这里固定住四种回收场景与释放失败的行为。
function lockPathFixture(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `kunqiong-file-lock-${name}-`))
  return path.join(directory, 'metadata.json.lock.v2')
}

function writeLock(lockPath, owner) {
  fs.writeFileSync(lockPath, JSON.stringify(owner))
}

// 一个确实存活、且不是本进程的 pid。
function foreignProcess() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio:'ignore' })
  assert.ok(Number.isSafeInteger(child.pid), 'spawned process exposes a pid')
  return { pid: child.pid, stop: () => child.kill() }
}

// 一个已经退出的 pid（模拟被强杀的实例）。
function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio:'ignore' })
  const pid = child.pid
  return new Promise((resolve) => child.once('exit', () => resolve(pid)))
}

function backdate(lockPath, milliseconds) {
  const stamp = new Date(Date.now() - milliseconds)
  fs.utimesSync(lockPath, stamp, stamp)
}

test('属主 pid 被复用（锁属于本进程但 token 不同）时回收锁并完成写入', () => {
  const lockPath = lockPathFixture('self-leaked')
  writeLock(lockPath, { pid: process.pid, token: 'token-from-killed-instance' })
  assert.equal(withFileLock(lockPath, () => 'written', 50), 'written')
  assert.equal(fs.existsSync(lockPath), false, '完成后锁已释放')
})

test('属主进程已退出时立即回收锁', () => {
  const lockPath = lockPathFixture('owner-exited')
  const child = foreignProcess()
  const pid = child.pid
  child.stop()
  writeLock(lockPath, { pid, token: 'token-from-dead-instance' })
  assert.equal(withFileLock(lockPath, () => 'written', 50), 'written')
  assert.equal(fs.existsSync(lockPath), false, '完成后锁已释放')
})

test('超过锁龄的锁即使属主 pid 仍存活也被回收（Windows pid 复用误判）', () => {
  const lockPath = lockPathFixture('pid-reused')
  const holder = foreignProcess()
  try {
    writeLock(lockPath, { pid: holder.pid, token: 'token-from-another-instance' })
    backdate(lockPath, 60 * 1000)
    assert.equal(withFileLock(lockPath, () => 'written', 50), 'written')
    assert.equal(fs.existsSync(lockPath), false, '完成后锁已释放')
  } finally {
    holder.stop()
  }
})

test('属主进程存活且锁是新的时仍然阻塞，不偷锁', () => {
  const lockPath = lockPathFixture('live-holder')
  const holder = foreignProcess()
  try {
    writeLock(lockPath, { pid: holder.pid, token: 'token-from-live-instance' })
    assert.throws(() => withFileLock(lockPath, () => 'must-not-run', 50), { code:'METADATA_LOCK_TIMEOUT' })
    assert.ok(fs.existsSync(lockPath), '他人的锁保持不动')
  } finally {
    holder.stop()
    fs.rmSync(lockPath, { force: true })
  }
})

test('内容损坏的锁按锁龄回收，不会永久卡死', () => {
  const lockPath = lockPathFixture('malformed')
  fs.writeFileSync(lockPath, '{ not json')
  assert.throws(() => withFileLock(lockPath, () => 'must-not-run', 50), { code:'METADATA_LOCK_TIMEOUT' })
  backdate(lockPath, 60 * 1000)
  assert.equal(withFileLock(lockPath, () => 'written', 50), 'written')
  assert.equal(fs.existsSync(lockPath), false, '完成后锁已释放')
})

test('释放锁时 unlink 持续失败也不抛异常、不改变任务结果', (t) => {
  const lockPath = lockPathFixture('release-failure')
  t.mock.method(fs, 'unlinkSync', () => {
    throw Object.assign(new Error('handle is busy'), { code:'EBUSY' })
  })
  assert.equal(withFileLock(lockPath, () => 'task-result'), 'task-result')
  assert.ok(fs.existsSync(lockPath), '删除失败时锁文件被泄漏，交由锁龄兜底回收')
  t.mock.restoreAll()
  fs.rmSync(path.dirname(lockPath), { recursive:true, force:true })
})

test('释放锁遇到瞬时占用会重试成功，不留下残留锁', (t) => {
  const lockPath = lockPathFixture('transient-release')
  const originalUnlink = fs.unlinkSync
  let calls = 0
  t.mock.method(fs, 'unlinkSync', (...args) => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('handle is busy'), { code:'EBUSY' })
    return originalUnlink.apply(fs, args)
  })
  assert.equal(withFileLock(lockPath, () => 'written'), 'written')
  t.mock.restoreAll()
  assert.ok(calls >= 2, '第一次失败后确实重试了')
  assert.equal(fs.existsSync(lockPath), false, '重试后锁被真正删除')
  fs.rmSync(path.dirname(lockPath), { recursive:true, force:true })
})

test('设备的同步 rmSync 静默失效时，锁仍然被真正删除', (t) => {
  // 复现真实故障：本机在 D:\demo\鲲穹文件传输\... 下 fs.rmSync 既不删除也不报错。
  // 释放锁一旦依赖它，锁会一直留在磁盘上，下一次写盘必然 METADATA_LOCK_TIMEOUT。
  const lockPath = lockPathFixture('rmSync-noop')
  t.mock.method(fs, 'rmSync', () => {})
  assert.equal(withFileLock(lockPath, () => 'written'), 'written')
  t.mock.restoreAll()
  assert.equal(fs.existsSync(lockPath), false, '锁必须真的从磁盘上消失')
  assert.deepEqual(fs.readdirSync(path.dirname(lockPath)).filter((name) => name.endsWith('.owner')), [], '候选文件不残留')
})

test('连续写盘不会被自己上一次的残留锁挡住', () => {
  const lockPath = lockPathFixture('sequential')
  for (let round = 0; round < 5; round++) assert.equal(withFileLock(lockPath, () => round, 50), round)
  assert.equal(fs.existsSync(lockPath), false, '完成后锁已释放')
})

test('首次抢到锁时清扫属主已退出的孤儿候选文件', async () => {
  const lockPath = lockPathFixture('orphan-sweep')
  const directory = path.dirname(lockPath)
  const dead = await exitedPid()
  const live = foreignProcess()
  try {
    fs.writeFileSync(`${lockPath}.${dead}.token-from-killed-instance.owner`, JSON.stringify({ pid:dead, token:'token-from-killed-instance' }))
    fs.writeFileSync(`${lockPath}.${live.pid}.still-running.owner`, JSON.stringify({ pid:live.pid, token:'still-running' }))
    assert.equal(withFileLock(lockPath, () => 'written'), 'written')
    const leftovers = fs.readdirSync(directory).filter((name) => name.endsWith('.owner'))
    assert.deepEqual(leftovers, [`${path.basename(lockPath)}.${live.pid}.still-running.owner`], '只清扫已退出进程的候选文件')
  } finally {
    live.stop()
    fs.rmSync(directory, { recursive:true, force:true })
  }
})
