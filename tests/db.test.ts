import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  openDb,
  upsertUserByTg,
  createWatcher,
  insertAlert,
  markAlertDelivered,
  cacheGet,
  cacheSet,
  pruneOldData,
  kvGet,
  type DB
} from '../src/db/index.js'

let db: DB
let watcherId = 0

beforeAll(() => {
  db = openDb(path.join(process.env.TEMP ?? '/tmp', `cheapkz-db-${Math.random().toString(36).slice(2)}.db`))
  const u = upsertUserByTg(db, '42', 'tester')
  watcherId = createWatcher(db, { user_id: u.id, kind: 'generic', title: 't', url: 'https://example.com' }).id
})

afterAll(() => db.close())

describe('кэш с TTL', () => {
  it('значение читается до истечения и исчезает после', () => {
    cacheSet(db, 'og:x', 'Название товара', 60_000)
    expect(cacheGet(db, 'og:x')).toBe('Название товара')

    cacheSet(db, 'og:y', 'протухшее', -1)
    expect(cacheGet(db, 'og:y')).toBeNull()
    // просроченная запись удаляется, а не копится
    expect(kvGet(db, 'og:y')).toBeNull()
  })

  it('значения с «|» не режутся', () => {
    cacheSet(db, 'og:z', 'a|b|c', 60_000)
    expect(cacheGet(db, 'og:z')).toBe('a|b|c')
  })

  it('отсутствующий ключ — null', () => {
    expect(cacheGet(db, 'og:нет')).toBeNull()
  })
})

describe('ретеншен', () => {
  it('удаляет старые точки истории, сохраняя свежие', () => {
    db.prepare(
      `INSERT INTO price_points (watcher_id, external_id, price, captured_at)
       VALUES (?, '*', 100, datetime('now','-400 days'))`
    ).run(watcherId)
    db.prepare(`INSERT INTO price_points (watcher_id, external_id, price) VALUES (?, '*', 200)`).run(watcherId)

    const removed = pruneOldData(db, 365)
    expect(removed).toBeGreaterThanOrEqual(1)
    const left = db.prepare(`SELECT price FROM price_points WHERE watcher_id=?`).all(watcherId) as Array<{
      price: number
    }>
    expect(left.map((r) => r.price)).toEqual([200])
  })

  it('доставленные алерты чистятся, недоставленные остаются', () => {
    const old = insertAlert(db, { watcher_id: watcherId, rule: 'target_hit', level: 'hot', message: 'm' })
    markAlertDelivered(db, old.id)
    db.prepare(`UPDATE alerts SET created_at=datetime('now','-400 days') WHERE id=?`).run(old.id)
    const pendingOld = insertAlert(db, { watcher_id: watcherId, rule: 'drop_pct', level: 'warm', message: 'm2' })
    db.prepare(`UPDATE alerts SET created_at=datetime('now','-400 days') WHERE id=?`).run(pendingOld.id)

    pruneOldData(db, 365)
    const ids = (db.prepare(`SELECT id FROM alerts`).all() as Array<{ id: number }>).map((r) => r.id)
    expect(ids).not.toContain(old.id)
    expect(ids).toContain(pendingOld.id)
  })

  it('retentionDays=0 отключает чистку', () => {
    expect(pruneOldData(db, 0)).toBe(0)
  })
})
