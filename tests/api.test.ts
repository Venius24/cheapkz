import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.js'
import { openDb, upsertUserByTg, createWatcher, addPoint } from '../src/db/index.js'
import type { DB } from '../src/db/index.js'
import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import { loadConfig } from '../src/config.js'
import { HttpGuard } from '../src/http/client.js'
import { ProxyPool } from '../src/http/proxies.js'
import { Scheduler } from '../src/worker/index.js'
import { Notifier } from '../src/core/notify.js'

let db: DB
let app: FastifyInstance
const TOKEN = 'test-admin-token-123'
let watcherId = 0

const tmpDb = (): string => path.join(process.env.TEMP ?? '/tmp', `cheapkz-test-${Math.random().toString(36).slice(2)}.db`)

beforeAll(async () => {
  db = openDb(tmpDb())
  const cfg = loadConfig({ adminToken: TOKEN, telegramToken: null, tpToken: null, proxies: [], port: 5999 })
  const guard = new HttpGuard(cfg, db, new ProxyPool([]))
  const notifier = new Notifier({ db, brand: cfg.brand, timezone: cfg.timezone })
  const scheduler = new Scheduler({ cfg, db, guard, notifier })
  app = createApp({ cfg, db, guard, scheduler })
  await app.ready()

  const user = upsertUserByTg(db, '111', 'tester')
  const w = createWatcher(db, {
    user_id: user.id,
    kind: 'kaspi',
    title: 'Тестовый товар',
    url: 'https://kaspi.kz/p/test/123/',
    target_price: 100
  })
  watcherId = w.id
  addPoint(db, w.id, '*', 150)
  addPoint(db, w.id, '*', 120)
})

afterAll(() => {
  db.close()
})

const auth = { authorization: `Bearer ${TOKEN}` }

describe('auth', () => {
  it('без токена — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/stats' })).statusCode).toBe(401)
  })
  it('с неверным токеном — 401', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/stats', headers: { authorization: 'Bearer wrong' } })).statusCode
    ).toBe(401)
  })
  it('токен той же длины, но другой — 401 (без падения на timingSafeEqual)', async () => {
    const same = 'x'.repeat(TOKEN.length)
    expect(
      (await app.inject({ method: 'GET', url: '/api/stats', headers: { authorization: `Bearer ${same}` } })).statusCode
    ).toBe(401)
  })
  it('многобайтный токен не роняет сервер 500-й', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stats', headers: { authorization: 'Bearer пароль' } })
    expect(r.statusCode).toBe(401)
  })
  it('токен можно передать query-параметром', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/stats?token=${TOKEN}` })).statusCode).toBe(200)
  })
  it('health открыт без авторизации', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
    expect(r.json().ok).toBe(true)
  })
})

describe('watchers CRUD', () => {
  it('список с вычисленными полями', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/watchers', headers: auth })
    expect(r.statusCode).toBe(200)
    const list = r.json()
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({ id: watcherId, kind: 'kaspi' })
    expect(list[0].params).toEqual({})
    expect(list[0].active).toBe(true)
  })

  it('создание с автодетектом kind', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/watchers',
      headers: auth,
      payload: { url: 'https://www.olx.kz/elektronika/q-ps5/', run_now: false }
    })
    expect(r.statusCode).toBe(201)
    expect(r.json().kind).toBe('olx')
  })

  it('generic без селектора -> 400, с params.selector -> 201', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/watchers',
      headers: auth,
      payload: { url: 'https://example.com/product', kind: 'generic', run_now: false }
    })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/watchers',
      headers: auth,
      payload: {
        url: 'https://example.com/product',
        kind: 'generic',
        params: { selector: '.price' },
        run_now: false
      }
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().params).toEqual({ selector: '.price' })
  })

  it('панель без Telegram-бота всё равно может создать наблюдение', async () => {
    const fresh = openDb(tmpDb())
    const cfg = loadConfig({ adminToken: TOKEN, telegramToken: null, tpToken: null, proxies: [], port: 5998 })
    const guard = new HttpGuard(cfg, fresh, new ProxyPool([]))
    const solo = createApp({ cfg, db: fresh, guard, scheduler: null })
    await solo.ready()
    expect((fresh.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(0)

    const r = await solo.inject({
      method: 'POST',
      url: '/api/watchers',
      headers: auth,
      payload: { url: 'https://kaspi.kz/p/x/1/', run_now: false }
    })
    expect(r.statusCode).toBe(201)
    expect((fresh.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(1)
    await solo.close()
    fresh.close()
  })

  it('run по несуществующему id -> 404', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/watchers/999999/run', headers: auth })
    expect(r.statusCode).toBe(404)
  })

  it('невалидный url -> 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/watchers',
      headers: auth,
      payload: { url: '::bad::' }
    })
    expect(r.statusCode).toBe(400)
  })

  it('patch меняет цель и паузит', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/watchers/${watcherId}`,
      headers: auth,
      payload: { target_price: 99, active: false }
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ target_price: 99, active: false })
  })

  it('history возвращает серию и тренд', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/watchers/${watcherId}/history?days=7`, headers: auth })
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j.series.length).toBe(2)
    expect(['down', 'flat', 'up']).toContain(j.trend)
  })

  it('detect endpoint', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/detect?url=https://krisha.kz/arenda/', headers: auth })
    expect(r.json().kind).toBe('krisha')
  })

  it('delete каскадом', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/watchers/${watcherId}`, headers: auth })
    expect(r.statusCode).toBe(200)
    const rest = (await app.inject({ method: 'GET', url: '/api/watchers', headers: auth })).json() as Array<{ id: number }>
    expect(rest.map((w) => w.id)).not.toContain(watcherId)
    expect((await app.inject({ method: 'DELETE', url: `/api/watchers/${watcherId}`, headers: auth })).statusCode).toBe(404)
  })
})

describe('deals / stats / metrics', () => {
  it('stats считает счётчики', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stats', headers: auth })
    expect(r.statusCode).toBe(200)
    expect(typeof r.json().watchers).toBe('number')
  })
  it('deals отдаёт массив (пустой после удаления)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/deals', headers: auth })
    expect(Array.isArray(r.json())).toBe(true)
  })
  it('settings roundtrip', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { default_interval_min: 15 } })
    expect(put.json().default_interval_min).toBe('15')
  })
  it('metrics в формате Prometheus: HELP/TYPE у каждой метрики', async () => {
    const r = await app.inject({ method: 'GET', url: '/metrics', headers: auth })
    expect(r.headers['content-type']).toContain('text/plain')
    expect(r.body).toContain('# HELP cheapkz_watchers_total')
    expect(r.body).toContain('# TYPE cheapkz_requests_total counter')
    expect(r.body).toContain('# TYPE cheapkz_uptime_seconds gauge')
    for (const line of r.body.trim().split('\n')) {
      expect(line.startsWith('#') || /^[a-z_][a-z0-9_]* -?\d+(\.\d+)?$/.test(line), line).toBe(true)
    }
  })
  it('metrics закрыт без токена', async () => {
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401)
  })
})
