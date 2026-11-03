const tasks = new Map()
let timer, wakeTimer
const visible = () => document.visibilityState !== 'hidden'
function run(entry) {
  if (!visible() || entry.running || Date.now() - entry.lastStarted < 1000) return
  entry.lastStarted = Date.now()
  entry.next = Date.now() + entry.interval
  entry.running = Promise.resolve().then(entry.task).catch(() => {}).finally(() => { entry.running = null })
}
const tick = () => { if (visible()) for (const entry of tasks.values()) if (entry.interval > 0 && Date.now() >= entry.next) run(entry) }
function wake() {
  if (!visible()) return
  window.clearTimeout(wakeTimer)
  wakeTimer = window.setTimeout(() => { for (const entry of tasks.values()) run(entry) }, 120)
}
export function subscribeRefresh(key, task, { interval = 30000 } = {}) {
  let entry = tasks.get(key)
  if (!entry) {
    entry = { task, interval, next: Date.now() + interval, lastStarted: 0, running: null, subscribers: 0 }
    tasks.set(key, entry)
  }
  entry.task = task; entry.interval = interval; entry.subscribers++
  if (!timer) {
    timer = window.setInterval(tick, 1000)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
  }
  return () => {
    if (--entry.subscribers === 0) tasks.delete(key)
    if (!tasks.size) {
      window.clearInterval(timer); window.clearTimeout(wakeTimer); timer = null
      window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake)
    }
  }
}
