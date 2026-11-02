import { AsyncLocalStorage } from 'node:async_hooks'

const requests = new AsyncLocalStorage()
const pending = new Set()

export function currentDataContext() { return requests.getStore() }
export function runWithDataContext(context, task) { return requests.run(context, task) }
export function trackDataOperation(operation) {
  pending.add(operation)
  operation.then(() => pending.delete(operation), () => pending.delete(operation))
  return operation
}
export async function flushDataOperations() {
  while (pending.size) await Promise.all([...pending])
}

// Domain modules keep their existing imports, but each async request sees its
// own objects. Database mode never publishes a process-wide business snapshot.
export function contextualObject(fallback, select) {
  const target = () => select(currentDataContext()) || fallback
  return new Proxy(fallback, {
    get(_object, key) { return Reflect.get(target(), key) },
    set(_object, key, value) { return Reflect.set(target(), key, value) },
    deleteProperty(_object, key) { return Reflect.deleteProperty(target(), key) },
    has(_object, key) { return Reflect.has(target(), key) },
    ownKeys() { return Reflect.ownKeys(target()) },
    getOwnPropertyDescriptor(_object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), key)
      return descriptor && { ...descriptor, configurable: true }
    },
  })
}
