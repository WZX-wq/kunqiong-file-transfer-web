export function positiveSetting(value, fallback, max = 1000000) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : fallback
}

const unavailable = code => Object.assign(new Error('数据库暂时繁忙，请稍后重试'), { status: 503, code })
const reconnectable = new Set(['DATABASE_QUERY_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'])
const retryableRead = sql => /^\s*SELECT\b[\s\S]*\bFROM\s+`?kq_\w+/i.test(sql)
  && !/;|\/\*|--|@|\b(?:FOR\s+UPDATE|FOR\s+SHARE|LOCK|INTO|GET_LOCK|RELEASE_LOCK|SLEEP|BENCHMARK)\b/i.test(sql)

// Creating this facade never connects. Late acquisitions after a timeout are
// released immediately, so abandoned HTTP requests cannot retain pool slots.
export function boundedPool(pool, { acquireTimeoutMs = 30000, queryTimeoutMs = 60000 } = {}) {
  const deadline = (operation, connection, timeout = queryTimeoutMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connection.destroy(); reject(unavailable('DATABASE_QUERY_TIMEOUT')) }, timeout)
    Promise.resolve(operation).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
  const acquire = (timeout = acquireTimeoutMs) => new Promise((resolve, reject) => {
    let expired = false
    const timer = setTimeout(() => { expired = true; reject(unavailable('DATABASE_QUEUE_TIMEOUT')) }, timeout)
    const connect = async () => {
      try { return await pool.getConnection() }
      catch (error) {
        // No SQL has been issued: retry a failed handshake once, including for
        // a leased transaction connection, inside the same acquisition timer.
        if (expired || !['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) throw error
        console.error(JSON.stringify({ event: 'database_connect_reconnect', code: error.code }))
        return pool.getConnection()
      }
    }
    connect().then(connection => {
      clearTimeout(timer)
      if (expired) return connection.release()
      const wrapped = new Proxy(connection, {
        get(target, key) {
          if (key === 'query' || key === 'execute') return async (sql, params) => {
            const timeout = Math.min(queryTimeoutMs, positiveSetting(sql?.timeout, queryTimeoutMs))
            try {
              return await deadline(target[key](typeof sql === 'string' ? { sql, timeout } : { ...sql, timeout }, params), target, timeout)
            } catch (error) {
              if (error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') { target.destroy(); throw unavailable('DATABASE_QUERY_TIMEOUT') }
              const text = typeof sql === 'string' ? sql : sql.sql
              console.error(JSON.stringify({ event: 'database_leased_query_failed', code: error.code || 'DATABASE_QUERY_FAILED',
                table: text.match(/\b(?:FROM|UPDATE|INTO)\s+`?(kq_\w+)/i)?.[1] || '' }))
              throw error
            }
          }
          if (['beginTransaction', 'commit', 'rollback'].includes(key)) return (...args) => deadline(target[key](...args), target)
          const value = target[key]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      resolve(wrapped)
    }, error => {
      clearTimeout(timer)
      if (!expired) reject(error.status ? error : unavailable(error.code || 'DATABASE_UNAVAILABLE'))
    })
  })
  return new Proxy(pool, {
    get(target, key) {
      if (key === 'getConnection') return acquire
      if (key === 'query' || key === 'execute') return async (sql, params) => {
        const statement = typeof sql === 'string' ? { sql } : sql
        const retry = retryableRead(statement.sql)
        const budget = Math.min(queryTimeoutMs, positiveSetting(statement.timeout, queryTimeoutMs))
        let expiresAt
        for (let attempt = 0; ; attempt++) {
          const remaining = expiresAt ? expiresAt - Date.now() : budget
          if (remaining <= 0) throw unavailable('DATABASE_QUERY_TIMEOUT')
          const connection = await acquire(Math.min(acquireTimeoutMs, remaining))
          expiresAt ??= Date.now() + budget
          const timeout = Math.min(expiresAt - Date.now(), retry && attempt === 0 ? Math.min(5000, Math.max(1, Math.floor(budget / 3))) : budget)
          try {
            if (timeout <= 0) throw unavailable('DATABASE_QUERY_TIMEOUT')
            return await connection[key]({ ...statement, timeout }, params)
          } catch (error) {
            // Replay only a non-locking application read, on a fresh connection,
            // once within the original deadline. Leased transactions never retry.
            if (!retry || attempt !== 0 || !reconnectable.has(error.code) || Date.now() >= expiresAt) {
              console.error(JSON.stringify({ event: 'database_query_failed', code: error.code || 'DATABASE_QUERY_FAILED',
                table: statement.sql.match(/\b(?:FROM|UPDATE|INTO)\s+`?(kq_\w+)/i)?.[1] || '',
                projection: /^\s*SELECT\s+id,\s*write_version/i.test(statement.sql) ? 'versions' : /^\s*SELECT\s+\*/i.test(statement.sql) ? 'rows' : 'other' }))
              throw error
            }
            connection.destroy()
            console.error(JSON.stringify({ event: 'database_read_reconnect', code: error.code }))
          } finally { connection.release() }
        }
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
