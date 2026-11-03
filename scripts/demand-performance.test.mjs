import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { requestMetrics, measureDatabaseOperation, measureRequestPreparation } from '../server/lib/request-metrics.js'
import { responseCompression } from '../server/lib/response-compression.js'
import fs from 'node:fs'
import vm from 'node:vm'

test('refresh scheduling coalesces wakeups, pauses hidden pages and keeps tasks single flight', async () => {
  let now = 10000, nextId = 0
  const timers = new Map(), window = new EventTarget(), document = new EventTarget()
  document.visibilityState = 'visible'
  const add = (fn, ms, repeat) => { const id = ++nextId; timers.set(id, { fn, at: now + ms, ms, repeat }); return id }
  window.setTimeout = (fn, ms) => add(fn, ms, false)
  window.setInterval = (fn, ms) => add(fn, ms, true)
  window.clearTimeout = window.clearInterval = id => timers.delete(id)
  const source = fs.readFileSync(new URL('../src/lib/refresh-scheduler.js', import.meta.url), 'utf8')
  const context = vm.createContext({ window, document, Date: { now: () => now }, Promise })
  vm.runInContext(source.replace('export function subscribeRefresh', 'function subscribeRefresh') + '\n globalThis.subscribe = subscribeRefresh', context)
  const advance = async ms => {
    const end = now + ms
    while (true) {
      const upcoming = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0]
      if (!upcoming) break
      const [id, timer] = upcoming; now = timer.at
      if (timer.repeat) timer.at += timer.ms; else timers.delete(id)
      timer.fn()
      for (let index=0; index<8; index++) await Promise.resolve()
    }
    now=end
  }
  let calls = 0, release
  const unsubscribe = context.subscribe('identity', () => { calls++; return new Promise(resolve => { release=resolve }) }, { interval: 2000 })
  const duplicate = context.subscribe('identity', () => { calls++; return new Promise(resolve => { release=resolve }) }, { interval: 2000 })
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await advance(200); assert.equal(calls,1)
  await advance(5000); assert.equal(calls,1, 'slow requests are never duplicated')
  release(); for (let index=0; index<8; index++) await Promise.resolve()
  document.visibilityState='hidden'; await advance(10000); assert.equal(calls,1)
  document.visibilityState='visible'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))
  await advance(200); assert.equal(calls,2)
  unsubscribe(); duplicate(); assert.equal(timers.size,0, 'last unsubscribe removes every timer')
  window.dispatchEvent(new Event('focus')); await advance(5000); assert.equal(calls,2)
  release()
})

test('request timings cover preparation, queued SQL and isolated concurrent requests', async t => {
  const reports = []
  const app = express()
  app.use(requestMetrics({ onFinish: (req,res,metrics) => reports.push({ path: req.path, ...metrics }) }))
  app.get('/api/slow', async (req,res) => {
    await measureRequestPreparation(async () => { await measureDatabaseOperation('queue', () => delay(15)); await measureDatabaseOperation('sql', () => delay(25)) })
    res.json({ ok: true })
  })
  app.get('/api/fast', (req,res) => res.json({ ok: true }))
  const server = app.listen(0,'127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening',resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const [slow,fast] = await Promise.all([fetch(base+'/api/slow'),fetch(base+'/api/fast')])
  assert.match(slow.headers.get('server-timing'), /prepare;dur=\d+, db;dur=\d+, dbqueue;dur=\d+, total;dur=\d+/)
  assert.notEqual(slow.headers.get('x-request-id'), fast.headers.get('x-request-id'))
  const a = reports.find(item => item.path === '/api/slow'), b = reports.find(item => item.path === '/api/fast')
  assert.equal(a.sqlCount,1); assert.equal(b.sqlCount,0)
  assert.ok(a.prepareMs >= 30 && a.sqlMs >= 20 && a.queueMs >= 10 && a.durationMs >= a.prepareMs)
})

test('compression negotiates text and excludes download attachments', async t => {
  const app=express(), body = 'compressible-text '.repeat(500)
  app.use(responseCompression())
  app.get('/asset.js', (req,res) => res.type('js').send(body))
  app.get('/api/file/download', (req,res) => res.attachment('example.txt').send(body))
  const server = app.listen(0,'127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening',resolve))
  const request = path => new Promise((resolve,reject) => http.get({hostname:'127.0.0.1',port:server.address().port,path,headers:{'accept-encoding':'gzip'}}, res => {
    const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({headers:res.headers,body:Buffer.concat(parts)}));res.on('error',reject)
  }).on('error',reject))
  const asset=await request('/asset.js'), file=await request('/api/file/download')
  assert.equal(asset.headers['content-encoding'],'gzip');assert.match(asset.headers.vary,/Accept-Encoding/)
  assert.ok(asset.body.length < body.length / 10)
  assert.equal(file.headers['content-encoding'],undefined);assert.equal(file.body.toString(),body)
})
