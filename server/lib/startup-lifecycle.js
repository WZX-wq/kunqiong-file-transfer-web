// HTTP starts independently of storage initialization. Database mode only
// initializes its request repository; standalone mode prepares its local store.
export function createStartupLifecycle({ initialize, onError }) {
  let status = 'starting'
  let stage = 'schema'
  let initialization

  return {
    get ready() { return status === 'ready' },
    get status() { return status },
    get stage() { return stage },
    start() {
      initialization ??= Promise.resolve().then(() => initialize((nextStage) => {
        if (status === 'stopping') throw Object.assign(new Error('Startup cancelled'), { code: 'STARTUP_STOPPING' })
        stage = nextStage
      })).then(() => {
        if (status !== 'stopping') status = 'ready'
      }).catch((error) => {
        if (status === 'stopping') return
        status = 'failed'
        onError(error, stage)
      })
      return initialization
    },
    stop() { status = 'stopping' },
    middleware(req, res, next) {
      if (status === 'ready' || !/^\/(?:api|auth)(?:\/|$)/i.test(req.path)) return next()
      const failed = status === 'failed'
      const message = failed ? '数据加载失败，请联系管理员' : '服务已启动，数据正在准备，请稍后重试'
      return res.status(503).set({
        'Cache-Control': 'no-store',
        'Retry-After': '5',
        'X-Error-Message': encodeURIComponent(message),
      }).json({ message, code: failed ? 'STARTUP_FAILED' : 'SERVICE_STARTING' })
    },
  }
}
