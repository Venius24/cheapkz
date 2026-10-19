import crypto from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/api/app.js'
import { verifyInitData } from '../src/api/auth.js'
import { loadConfig } from '../src/config.js'
import { openDb, upsertUserByTg, createWatcher, insertAlert, type DB } from '../src/db/index.js'
import { HttpGuard } from '../src/http/client.js'
import { ProxyPool } from '../src/http/proxies.js'

const BOT = '123456:TEST-bot-token'
const ADMIN = 'test-admin-token-123'

/** initData так, как его подписывает Telegram. */
function sign(fields: Record<string, string>, token = BOT): string {
  const dataCheck = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}

const now = () => String(Math.floor(Date.now() / 1000))
const initFor = (id: number, username = `u${id}`) => sign({ auth_date: now(), query_id: 'AAA', user: JSON.stringify({ id, username }) })

describe('verifyInitData', () => {
  it('принимает корректную подпись', () => {
    expect(verifyInitData(initFor(42, 'neo'), BOT)).toEqual({ id: '42', username: 'neo' })
  })
  it('отвергает подделанные поля', () => {
    const bad = initFor(42).replace('42', '43')
    expect(verifyInitData(bad, BOT)).toBeNull()
  })
  it('отвергает чужой токен бота', () => {
    expect(verifyInitData(sign({ auth_date: now(), user: '{"id":1}' }, 'other:token'), BOT)).toBeNull()
  })
  it('отвергает устаревший auth_date', () => {
    const old = sign({ auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400), user: '{"id":1}' })
    expect(verifyInitData(old, BOT)).toBeNull()
  })
  it('отвергает мусор', () => {
    expect(verifyInitData('', BOT)).toBeNull()
    expect(verifyInitData('hash=zz', BOT)).toBeNull()
  })
})

describe('Mini App: данные только свои', () => {
  let db: DB
  let app: FastifyInstance
  let mine = 0
  let theirs = 0

  beforeAll(async () => {
    db = openDb(path.join(process.env.TEMP ?? '/tmp', `cheapkz-auth-${Math.random().toString(36).slice(2)}.db`))
    const cfg = loadConfig({ adminToken: ADMIN, telegramToken: BOT, tpToken: null, proxies: [], port: 5997 })
    app = createApp({ cfg, db, guard: new HttpGuard(cfg, db, new ProxyPool([])), scheduler: null })
    await app.ready()
    const a = upsertUserByTg(db, '1001', 'alice')
    const b = upsertUserByTg(db, '2002', 'bob')
    mine = createWatcher(db, { user_id: a.id, kind: 'kaspi', title: 'Алисин', url: 'https://kaspi.kz/p/a/1/' }).id
    theirs = createWatcher(db, { user_id: b.id, kind: 'kaspi', title: 'Бобов', url: 'https://kaspi.kz/p/b/2/' }).id
    insertAlert(db, { watcher_id: theirs, rule: 'target', level: 'hot', message: 'x', price: 1 })
  })
  afterAll(() => db.close())

  const tma = { authorization: `tma ${initFor(1001, 'alice')}` }

  it('/api/me — режим telegram', async () => {
    const r = await app.inject({ url: '/api/me', headers: tma })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ mode: 'telegram', user: { username: 'alice' } })
  })

  it('список наблюдений — только свои', async () => {
    const r = await app.inject({ url: '/api/watchers', headers: tma })
    expect(r.json().map((w: { id: number }) => w.id)).toEqual([mine])
  })

  it('чужое наблюдение — 404 на чтение, правку и удаление', async () => {
    expect((await app.inject({ url: `/api/watchers/${theirs}/history`, headers: tma })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: `/api/watchers/${theirs}`, headers: tma, payload: { active: false } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/watchers/${theirs}`, headers: tma })).statusCode).toBe(404)
  })

  it('алерты и статистика — без чужих', async () => {
    expect((await app.inject({ url: '/api/alerts', headers: tma })).json()).toEqual([])
    expect((await app.inject({ url: '/api/stats', headers: tma })).json()).toMatchObject({ watchers: 1, alerts24h: 0 })
  })

  it('новое наблюдение принадлежит пользователю Mini App', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/watchers', headers: tma, payload: { url: 'https://kaspi.kz/p/c/3/', run_now: false } })
    expect(r.statusCode).toBe(201)
    const list = (await app.inject({ url: '/api/watchers', headers: tma })).json()
    expect(list).toHaveLength(2)
  })

  it('системная телеметрия и глобальные настройки закрыты', async () => {
    expect((await app.inject({ url: '/api/settings', headers: tma })).statusCode).toBe(403)
    expect((await app.inject({ url: '/metrics', headers: tma })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/system', headers: tma })).json()).not.toHaveProperty('proxies')
  })

  it('личные настройки уведомлений сохраняются', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/me', headers: tma, payload: { quiet_from: '23:00', quiet_to: '7:00', digest_hour: 9 } })
    expect(r.statusCode).toBe(200)
    expect(r.json().user).toMatchObject({ quiet_from: '23:00', quiet_to: '07:00', digest_hour: 9 })
    expect((await app.inject({ method: 'PATCH', url: '/api/me', headers: tma, payload: { quiet_from: '25:00', quiet_to: '07:00' } })).statusCode).toBe(400)
  })

  it('админ по-прежнему видит всё', async () => {
    const r = await app.inject({ url: '/api/watchers', headers: { authorization: `Bearer ${ADMIN}` } })
    expect(r.json().length).toBe(3)
  })

  it('поддельный initData — 401', async () => {
    expect((await app.inject({ url: '/api/me', headers: { authorization: 'tma user=%7B%22id%22%3A1%7D&hash=' + 'a'.repeat(64) } })).statusCode).toBe(401)
  })
})
