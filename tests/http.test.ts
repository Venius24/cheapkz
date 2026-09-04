import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { HttpGuard, isCaptcha } from '../src/http/client.js'
import { ProxyPool } from '../src/http/proxies.js'
import { openDb, type DB } from '../src/db/index.js'
import { loadConfig, type Config } from '../src/config.js'

let server: http.Server
let base = ''
let db: DB
let guard: HttpGuard
let cfg: Config
/** сколько раз запрашивали каждый путь — чтобы проверить ретраи */
const hits: Record<string, number> = {}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    hits[url] = (hits[url] ?? 0) + 1
    if (url === '/ok') return void res.end('привет')
    if (url === '/json') {
      res.setHeader('content-type', 'application/json')
      return void res.end('{"a":1}')
    }
    if (url === '/redirect') {
      res.statusCode = 302
      res.setHeader('location', '/ok')
      return void res.end()
    }
    if (url === '/loop') {
      res.statusCode = 302
      res.setHeader('location', '/loop')
      return void res.end()
    }
    if (url === '/404') {
      res.statusCode = 404
      return void res.end('нет')
    }
    if (url === '/403') {
      res.statusCode = 403
      return void res.end('403')
    }
    if (url === '/500') {
      res.statusCode = 500
      return void res.end('boom')
    }
    if (url === '/big') return void res.end('x'.repeat(50_000))
    if (url === '/badjson') return void res.end('<html>не json</html>')
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`

  db = openDb(path.join(process.env.TEMP ?? '/tmp', `cheapkz-http-${Math.random().toString(36).slice(2)}.db`))
  // локальный сервер — это как раз «внутренняя сеть», поэтому включаем явно
  cfg = loadConfig({ allowPrivateTargets: true, minDelayMs: [0, 0], maxConcurrency: 4, proxies: [] })
  guard = new HttpGuard(cfg, db, new ProxyPool([]), { capacity: 50, refillMs: 1 })
})

afterAll(async () => {
  await guard.close()
  await new Promise<void>((r) => server.close(() => r()))
  db.close()
})

describe('HttpGuard', () => {
  it('получает текст', async () => {
    const r = await guard.getText(`${base}/ok`)
    expect(r.status).toBe(200)
    expect(r.body).toBe('привет')
  })

  it('следует за редиректом и возвращает финальный URL', async () => {
    const r = await guard.getText(`${base}/redirect`)
    expect(r.body).toBe('привет')
    expect(r.url).toBe(`${base}/ok`)
  })

  it('обрывает бесконечный цикл редиректов', async () => {
    await expect(guard.getText(`${base}/loop`)).rejects.toThrow(/редирект/)
  })

  it('404 не ретраится и даёт код NOT_FOUND', async () => {
    hits['/404'] = 0
    await expect(guard.getText(`${base}/404`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(hits['/404']).toBe(1)
  })

  it('403 считается блокировкой и ретраится', async () => {
    hits['/403'] = 0
    await expect(guard.getText(`${base}/403`, { retries: 2 })).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(hits['/403']).toBe(2)
  })

  it('5xx ретраится и даёт NETWORK', async () => {
    hits['/500'] = 0
    await expect(guard.getText(`${base}/500`, { retries: 3 })).rejects.toMatchObject({ code: 'NETWORK' })
    expect(hits['/500']).toBe(3)
  })

  it('тело обрезается по maxBytes', async () => {
    const r = await guard.getText(`${base}/big`, { maxBytes: 1024 })
    expect(r.body.length).toBe(1024)
  })

  it('getJson парсит и падает с PARSE на не-JSON', async () => {
    expect(await guard.getJson<{ a: number }>(`${base}/json`)).toEqual({ a: 1 })
    await expect(guard.getJson(`${base}/badjson`)).rejects.toMatchObject({ code: 'PARSE' })
  })

  it('внутренние адреса блокируются, когда SSRF-защита включена', async () => {
    const strict = new HttpGuard({ ...cfg, allowPrivateTargets: false }, db, new ProxyPool([]), {
      capacity: 50,
      refillMs: 1
    })
    await expect(strict.getText(`${base}/ok`)).rejects.toMatchObject({ code: 'CONFIG' })
    await strict.close()
  })

  it('секреты не попадают в текст ошибки', async () => {
    await expect(guard.getText(`${base}/404?token=super-secret-value`)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret-value') })
    )
  })

  it('капча в теле распознаётся', () => {
    expect(isCaptcha('<html><title>Just a moment...</title>')).toBe(true)
    expect(isCaptcha('<html>обычная страница</html>')).toBe(false)
  })
})
