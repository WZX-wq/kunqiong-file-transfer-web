import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// 锁由「候选文件 + 硬链接」原子建立：属主记录先完整写进候选文件，再 link 到锁名，
// 所以锁名一旦存在，其内容必然是完整的属主记录。绝不在未持有锁的情况下执行任务。
//
// 残留锁回收：锁只在同步落盘期间短暂持有（毫秒级），且落盘任务不会递归加锁。
// 因此下列情况都说明锁已无人持有，必须回收，否则写盘会一直等到超时：
//   · 属主进程探测不到（ESRCH）
//   · 属主 pid 是本进程但 token 不是本次持有（上次释放失败留下的自锁）
//   · 锁龄超过 STALE_LOCK_MS
// 这些兜底针对的都是「释放没做干净」。历史故障：释放锁曾用 fs.rmSync，而本项目所在的
// 非 ASCII 路径下同步 rmSync 会静默无操作（见 removeFile 注释），锁文件因此永远留着；
// 之后每次写盘看到属主是自己、进程还活着，只能一路等到超时——服务被自己的锁锁死，
// 所有 /api/* 返回 503（METADATA_LOCK_TIMEOUT）。只靠 pid 存活探测也不够：Windows 会
// 快速复用 pid，被强杀的实例留下的锁可能恰好与新进程同 pid。二者都要防。
const STALE_LOCK_MS = 15 * 1000
// 每个锁名只在首次抢到锁后清扫一次孤儿候选文件：孤儿来自上一个进程，扫一遍就够，
// 免得每次写盘都去 readdir 目录。
const sweptLockPaths = new Set()

export function withFileLock(lockPath, task, timeout = 2000) {
  const token = crypto.randomUUID()
  const candidate = `${lockPath}.${process.pid}.${token}.owner`
  fs.writeFileSync(candidate, JSON.stringify({ pid: process.pid, token }), { flag:'wx', mode:0o600 })
  const deadline = Date.now() + timeout
  let acquired = false
  try {
    while (!acquired) {
      try { fs.linkSync(candidate, lockPath); acquired = true }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (reclaimStaleLock(lockPath)) continue
        if (Date.now() >= deadline) throw Object.assign(new Error('元数据写入锁繁忙，请稍后重试'), { status:503, code:'METADATA_LOCK_TIMEOUT' })
        sleep(2)
      }
    }
    if (!sweptLockPaths.has(lockPath)) {
      sweptLockPaths.add(lockPath)
      sweepOrphanCandidates(lockPath, candidate)
    }
    return task()
  } finally {
    // 释放失败不能往上抛：它会盖掉任务本身的异常，还会把锁连同 .owner 候选文件一起
    // 泄漏给下一个写者（早先正是这里让服务卡住）。最终回收交给锁龄兜底。
    if (acquired) removeLock(lockPath)
    removeFile(candidate)
  }
}

export function durableWrite(filename, data) {
  const fd = fs.openSync(filename, 'w', 0o600)
  try { fs.writeFileSync(fd, data, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

// 删除单个文件。统一走 unlinkSync，不用 fs.rmSync：实测在部分 Windows 目录下
// （例如本项目所在的非 ASCII 路径 D:\demo\鲲穹文件传输\...）同步 fs.rmSync 会静默返回
// ——既不删除也不报错，异步 fs.rm 和 unlinkSync 都正常。锁释放依赖这个动作，静默失败
// 会让锁永远释放不掉，服务随即被自己的锁卡死（所有 /api/* 返回 503）。
// ENOENT（已不存在）视为成功。
export function removeFile(filename, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { fs.unlinkSync(filename); return true }
    catch (error) {
      if (error.code === 'ENOENT') return true
      if (attempt === attempts - 1) return false
      sleep(2)
    }
  }
  return false
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// 返回 true 表示锁已（或已被别人）回收，调用方应立即重试 linkSync。
function reclaimStaleLock(lockPath) {
  const age = lockAge(lockPath)
  if (age === null) return true
  const owner = readLockOwner(lockPath)
  const current = Number.isSafeInteger(owner?.pid) && owner.pid > 0 ? owner : null
  // 读不出 pid（文件被手工清空/截断）：没有属主信息可核对，只能依赖锁龄。
  if (!current) return age >= STALE_LOCK_MS && unlinkLock(lockPath, null, 'malformed-lock')
  // 本进程自己留下的锁：本次尚未获得锁，而落盘任务不递归加锁，所以它一定是泄漏的。
  if (current.pid === process.pid) return unlinkLock(lockPath, current, 'self-leaked-lock')
  if (pidIsGone(current.pid)) return unlinkLock(lockPath, current, 'owner-exited')
  // 属主 pid 仍存活：可能真的在写，也可能是 pid 被复用，靠锁龄区分。
  return age >= STALE_LOCK_MS && unlinkLock(lockPath, current, 'owner-pid-reused')
}

// 删除前重新核对属主：期间锁可能已被别人回收并重建，绝不能误删新属主的锁。
function unlinkLock(lockPath, expected, reason) {
  const current = readLockOwner(lockPath)
  if (!current) {
    // 文件已消失（别人回收了）→ 直接重试抢锁；内容损坏 → 只有 malformed 判定才清理。
    if (!fs.existsSync(lockPath)) return true
    return reason === 'malformed-lock' && removeLock(lockPath, reason)
  }
  if (current.pid !== expected?.pid || current.token !== expected?.token) return false
  return removeLock(lockPath, reason)
}

// Windows 上删除可能因句柄被占用（杀毒、索引服务）而抛 EPERM/EBUSY，这里重试几次；
// 最终仍失败只记录日志，绝不抛出：抛出会盖掉调用方的真实结果，也会把锁泄漏给下一个
// 写者——那时由锁龄兜底在 STALE_LOCK_MS 后回收。
function removeLock(lockPath, reason) {
  if (removeFile(lockPath)) {
    if (reason && reason !== 'owner-exited') console.warn(JSON.stringify({ event:'file_lock_reclaimed', lock:path.basename(lockPath), reason }))
    return true
  }
  console.warn(JSON.stringify({ event:'file_lock_release_failed', lock:path.basename(lockPath), reason:reason || 'release', code:'LOCK_RELEASE_FAILED' }))
  return false
}

// 被强杀的进程（start.ps1 的 Stop-Process -Force）来不及执行 finally，会把 .owner
// 候选文件留在 storage 里。它们只是属主记录，但堆积起来会干扰排查、也让「清理锁」
// 无从下手。这里只清理「属主进程已确认退出」的候选：存活进程的候选文件正在用于
// linkSync，删掉会让它抛 ENOENT。
function sweepOrphanCandidates(lockPath, candidate) {
  const directory = path.dirname(lockPath)
  const prefix = `${path.basename(lockPath)}.`
  let names
  try { names = fs.readdirSync(directory) } catch { return }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.owner')) continue
    const orphanPath = path.join(directory, name)
    if (orphanPath === candidate) continue
    const owner = readLockOwner(orphanPath)
    if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) continue
    if (owner.pid === process.pid || !pidIsGone(owner.pid)) continue
    removeFile(orphanPath)
  }
}

function lockAge(lockPath) {
  try { return Date.now() - fs.statSync(lockPath).mtimeMs } catch { return null }
}

function pidIsGone(pid) {
  try { process.kill(pid, 0); return false }
  catch (probe) { return probe.code === 'ESRCH' }
}

function readLockOwner(lockPath) {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')) } catch { return null }
}
