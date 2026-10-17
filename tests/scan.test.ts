import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { openDb, upsertUserByTg, createWatcher, listAnomalies, getWatcher, type DB } from '../src/db/index.js'
import { applyScan, MAX_ALERTS_PER_RUN } from '../src/worker/scan.js'
import type { ScanItem } from '../src/sources/scan.js'

const tmpDb = (): string => path.join(process.env.TEMP ?? '/tmp', `cheapkz-scan-${Math.random().toString(36).slice(2)}.db`)

let db: DB

beforeEach(() => {
  db = openDb(tmpDb())
})
afterEach(() => db.close())

function scan(kind: 'krisha_zone' | 'kaspi_category', params: Record<string, unknown> = {}) {
  const user = upsertUserByTg(db, '42', 't')
  return createWatcher(db, { user_id: user.id, kind, title: 'скан', url: '', params_json: JSON.stringify(params) })
}

const flat = (id: string, price: number, area: number, rooms = 2): ScanItem => ({
  externalId: id,
  title: `${rooms}-комнатная квартира · ${area} м²`,
  url: `https://krisha.kz/a/show/${id}`,
  price,
  meta: {
    zone: 'almaty-bostandykskij',
    zoneLabel: 'Бостандыкский р-н',
    market: 'arenda|almaty-bostandykskij',
    group: `arenda|almaty-bostandykskij|${rooms}`,
    area,
    unit: Math.round(price / area),
    image: null,
    deal: 'arenda'
  }
})

const product = (id: string, price: number): ScanItem => ({
  externalId: id,
  title: `Товар ${id}`,
  url: `https://kaspi.kz/p/x-${id}/`,
  price,
  meta: { zone: 'Smartphones', zoneLabel: 'Смартфоны', group: null, unit: null, image: null }
})

const alerts = (wid: number) =>
  db.prepare(`SELECT rule, level, message FROM alerts WHERE watcher_id=? ORDER BY id`).all(wid) as Array<{
    rule: string
    level: string
    message: string
  }>

describe('applyScan: Krisha', () => {
  it('новое объявление сильно ниже медианы района → находка и алерт', () => {
    const w = scan('krisha_zone')
    const market = Array.from({ length: 8 }, (_, i) => flat(`m${i}`, 600_000 + i * 5_000, 60))
    const r = applyScan(db, w, w.params_json ? JSON.parse(w.params_json) : {}, [...market, flat('cheap', 360_000, 60)])
    expect(r.offers).toBe(9)
    expect(r.anomalies).toBe(1)
    const [a] = listAnomalies(db)
    expect(a).toMatchObject({ source: 'krisha', kind: 'market', external_id: 'cheap', zone: 'almaty-bostandykskij' })
    expect(a.pct).toBeGreaterThan(35)
    const al = alerts(w.id)
    expect(al).toHaveLength(1)
    expect(al[0].rule).toBe('anomaly_market')
    expect(al[0].message).toContain('Бостандыкский р-н')
    expect(al[0].message).toContain('/м²')
  })

  it('повторный проход с той же ценой не дублирует находку', () => {
    const w = scan('krisha_zone')
    const items = [...Array.from({ length: 8 }, (_, i) => flat(`m${i}`, 600_000, 60)), flat('cheap', 360_000, 60)]
    applyScan(db, w, {}, items)
    const again = applyScan(db, w, {}, items)
    expect(again.anomalies).toBe(0)
    expect(listAnomalies(db)).toHaveLength(1)
  })

  it('хозяин снизил цену на 12% → сигнал drop', () => {
    const w = scan('krisha_zone', { below_pct: 60 })
    applyScan(db, w, { below_pct: 60 }, [flat('x', 500_000, 50)])
    const r = applyScan(db, w, { below_pct: 60 }, [flat('x', 440_000, 50)])
    expect(r.anomalies).toBe(1)
    expect(listAnomalies(db)[0]).toMatchObject({ kind: 'drop', ref_value: 500_000, pct: 12 })
  })

  it('алертов за проход не больше лимита, остаток — одной сводкой', () => {
    const w = scan('krisha_zone')
    const market = Array.from({ length: 12 }, (_, i) => flat(`m${i}`, 600_000, 60))
    const cheap = Array.from({ length: 8 }, (_, i) => flat(`c${i}`, 300_000 + i * 1_000, 60))
    const r = applyScan(db, w, {}, [...market, ...cheap])
    expect(r.anomalies).toBe(8)
    const al = alerts(w.id)
    expect(al.filter((a) => a.rule.startsWith('anomaly_') && a.rule !== 'anomaly_more')).toHaveLength(MAX_ALERTS_PER_RUN)
    expect(al.at(-1)?.rule).toBe('anomaly_more')
    // в ленте — все находки
    expect(listAnomalies(db)).toHaveLength(8)
  })
})

describe('applyScan: Kaspi', () => {
  it('первый проход только набирает историю, падение на втором — аномалия', () => {
    const w = scan('kaspi_category', { categories: ['Smartphones'] })
    const p = { categories: ['Smartphones'] }
    expect(applyScan(db, w, p, [product('1', 100_000), product('2', 50_000)]).anomalies).toBe(0)
    applyScan(db, w, p, [product('1', 100_000), product('2', 50_000)])
    const r = applyScan(db, w, p, [product('1', 85_000), product('2', 49_000)])
    expect(r.anomalies).toBe(1)
    const [a] = listAnomalies(db, { source: 'kaspi' })
    expect(a).toMatchObject({ external_id: '1', kind: 'drop', pct: 15, level: 'hot' })
    expect(alerts(w.id)[0].message).toContain('−15%')
    expect(getWatcher(db, w.id)?.best_title).toBe('2 позиций · аномалий: 1')
  })

  it('дешевле min_price — хранится, но не оценивается', () => {
    const w = scan('kaspi_category')
    const p = { min_price: 5000 }
    applyScan(db, w, p, [product('c', 3_000)])
    expect(applyScan(db, w, p, [product('c', 1_000)]).anomalies).toBe(0)
  })
})

describe('applyScan: сопоставимость', () => {
  it('большая квартира не считается аномалией на фоне маленьких', () => {
    const w = scan('krisha_zone')
    // 8 однушек по 40 м² за 10 000 ₸/м² и одна 150-метровая за 6 000 ₸/м² — это норма для большой площади
    const small = Array.from({ length: 8 }, (_, i) => flat(`s${i}`, 400_000, 40, 3))
    expect(applyScan(db, w, {}, [...small, flat('big', 900_000, 150, 3)]).anomalies).toBe(0)
  })

  it('аренда и продажа одного района не смешиваются', () => {
    const w = scan('krisha_zone')
    const sale = (id: string, price: number): ScanItem => {
      const f = flat(id, price, 60)
      return { ...f, meta: { ...f.meta, deal: 'prodazha', market: 'prodazha|almaty-bostandykskij', group: 'prodazha|almaty-bostandykskij|2' } }
    }
    // аренда за 600 000 ₸ «в сто раз дешевле» продажи — но это другой рынок
    const r = applyScan(db, w, {}, [...Array.from({ length: 8 }, (_, i) => sale(`p${i}`, 60_000_000)), flat('rent', 600_000, 60)])
    expect(r.anomalies).toBe(0)
  })
})
