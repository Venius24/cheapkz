import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/api/app.js'
import { normalizeScan } from '../src/api/detector.js'
import { openDb, getWatcher, type DB } from '../src/db/index.js'
import { loadConfig } from '../src/config.js'
import { HttpGuard } from '../src/http/client.js'
import { ProxyPool } from '../src/http/proxies.js'
import { applyScan } from '../src/worker/scan.js'
import type { ScanItem } from '../src/sources/scan.js'

let db: DB
let app: FastifyInstance
const TOKEN = 'test-admin-token-456'
const auth = { authorization: `Bearer ${TOKEN}` }

beforeAll(async () => {
  db = openDb(path.join(process.env.TEMP ?? '/tmp', `cheapkz-det-${Math.random().toString(36).slice(2)}.db`))
  const cfg = loadConfig({ adminToken: TOKEN, telegramToken: null, tpToken: null, proxies: [], port: 5998 })
  // без планировщика: тест не должен ходить в сеть
  app = createApp({ cfg, db, guard: new HttpGuard(cfg, db, new ProxyPool([])), scheduler: null })
  await app.ready()
})
afterAll(() => db.close())

describe('normalizeScan', () => {
  it('Krisha: чужие и неизвестные районы отбрасываются, пороги зажимаются', () => {
    const { params, title } = normalizeScan('krisha_zone', {
      city: 'almaty',
      districts: ['almaty-medeuskij', 'astana-nura', 'evil/../x', 'almaty-medeuskij'],
      rooms: [2, 9, 1],
      drop_pct: 500
    })
    expect(params).toMatchObject({ districts: ['almaty-medeuskij'], deal: 'arenda', rooms: [1, 2], drop_pct: 50, below_pct: 25 })
    expect(title).toBe('🏠 Алматы · аренда · 1 р-н.')
  })
  it('Kaspi: широкий режим не требует категорий, город → id Kaspi', () => {
    const { params, title } = normalizeScan('kaspi_category', { city: 'astana', mode: 'broad' })
    expect(params).toMatchObject({ city: '750000000', mode: 'broad', categories: [], drop_pct: 15 })
    expect(title).toContain('широкий скан')
  })
  it('Kaspi: код с инъекцией фильтра отбрасывается', () => {
    expect(() => normalizeScan('kaspi_category', { city: 'almaty', categories: ['TVs:brand:x'] })).toThrow(/категорию/)
  })
})

describe('API детектора', () => {
  it('каталог: города с районами и категории', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/detector/catalog', headers: auth })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.cities.map((c: { id: string }) => c.id)).toEqual(['almaty', 'astana', 'shymkent'])
    expect(body.categories.length).toBeGreaterThan(10)
  })
  it('без токена — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/detector/scans' })).statusCode).toBe(401)
  })
  it('создание скана: 400 без районов, 201 с районами; скан не попадает в ленту сделок', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/detector/scans',
      headers: auth,
      payload: { kind: 'krisha_zone', params: { city: 'almaty', districts: [] } }
    })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/detector/scans',
      headers: auth,
      payload: { kind: 'krisha_zone', interval_min: 5, params: { city: 'almaty', districts: ['almaty-bostandykskij'] } }
    })
    expect(ok.statusCode).toBe(201)
    const scan = ok.json()
    expect(scan).toMatchObject({ kind: 'krisha_zone', interval_min: 15, active: true })

    const list = (await app.inject({ method: 'GET', url: '/api/detector/scans', headers: auth })).json()
    expect(list.map((s: { id: number }) => s.id)).toContain(scan.id)

    // находки появляются в ленте и в статистике районов
    const w = getWatcher(db, scan.id)!
    const flat = (id: string, price: number): ScanItem => ({
      externalId: id,
      title: '2-комнатная квартира · 60 м²',
      url: `https://krisha.kz/a/show/${id}`,
      price,
      meta: {
        zone: 'almaty-bostandykskij',
        zoneLabel: 'Бостандыкский р-н',
        market: 'arenda|almaty-bostandykskij',
        group: 'arenda|almaty-bostandykskij|2',
        area: 60,
        unit: Math.round(price / 60),
        image: null,
        deal: 'arenda'
      }
    })
    applyScan(db, w, JSON.parse(w.params_json), [...Array.from({ length: 8 }, (_, i) => flat(`m${i}`, 600_000)), flat('cheap', 300_000)])

    const feed = (await app.inject({ method: 'GET', url: '/api/detector/anomalies?source=krisha', headers: auth })).json()
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ external_id: 'cheap', suspicious: false, ago: 'только что' })
    expect(feed[0].meta.zone).toBe('almaty-bostandykskij')

    const zones = (await app.inject({ method: 'GET', url: '/api/detector/zones?deal=arenda', headers: auth })).json()
    expect(zones.zones['almaty-bostandykskij']).toMatchObject({ listings: 9, medianUnit: 10_000, anomalies7d: 1 })
    expect(zones.zones['almaty-medeuskij'].listings).toBe(0)

    const deals = (await app.inject({ method: 'GET', url: '/api/deals', headers: auth })).json()
    expect(deals.find((d: { id: number }) => d.id === scan.id)).toBeUndefined()
  })
  it('PUT меняет выбор и авто-заголовок, валидирует параметры', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/detector/scans',
        headers: auth,
        payload: { kind: 'kaspi_category', params: { city: 'almaty', categories: ['TVs'] } }
      })
    ).json()
    expect(created.title).toBe('🛒 Kaspi · Алматы · Телевизоры')
    const upd = await app.inject({
      method: 'PUT',
      url: `/api/detector/scans/${created.id}`,
      headers: auth,
      payload: { params: { city: 'almaty', categories: ['TVs', 'Notebooks'] }, active: false }
    })
    expect(upd.statusCode).toBe(200)
    expect(upd.json()).toMatchObject({ title: '🛒 Kaspi · Алматы · 2 категор.', active: false })
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/detector/scans/${created.id}`,
      headers: auth,
      payload: { params: { city: 'moscow' } }
    })
    expect(bad.statusCode).toBe(400)
  })
})
