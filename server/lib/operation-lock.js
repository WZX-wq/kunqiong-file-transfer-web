const operations = new Map()

// Complements database aggregate locks: a follower must load its own fresh
// request data after its predecessor has committed, never reuse its response.
export async function acquireOperationLock(key) {
  const previous = operations.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  operations.set(key, current)
  await previous
  return () => {
    if (operations.get(key) === current) operations.delete(key)
    release()
  }
}
