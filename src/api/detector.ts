import type { FastifyInstance } from 'fastify'
import {
  anomalyCountsByZone,
  createWatcher,
  ensureLocalUser,
  getWatcher,
  listAnomalies,
  listWatchers,
  recentScanOffers,
  updateWatcher,
  type DB,
  type WatcherRow
} from '../db/index.js'
import { CITIES, KASPI_CATEGORIES, findCity, findKaspiCategory, isValidCategoryCode } from '../sources/catalog.js'
import { isScanKind, type ScanMeta } from '../sources/scan.js'
import { median } from '../core/anomaly.js'
import { MARKET_WINDOW_DAYS } from '../worker/scan.js'
import type { Scheduler } from '../worker/index.js'
import { safeJson, timeAgoRu } from '../util.js'

interface DetectorDeps {
  db: DB
  scheduler: Scheduler | null
}

class BadRequest extends Error {}

const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n))
}

/** Нормализация и проверка параметров скана — в БД попадает только то, что понимает сканер. */
export function normalizeScan(kind: string, raw: Record<string, unknown>): { params: Record<string, unknown>; title: string } {
  const cityId = String(raw.city ?? '')
  const city = findCity(cityId)
  if (!city) throw new BadRequest(`city должен быть одним из: ${CITIES.map((c) => c.id).join(', ')}`)

  if (kind === 'krisha_zone') {
    const allowed = new Set(city.districts.map((d) => d.alias))
    const districts = [...new Set((Array.isArray(raw.districts) ? raw.districts : []).map(String))].filter((a) =>
      allowed.has(a)
    )
    if (!districts.length) throw new BadRequest('выберите хотя бы один район на карте')
    const deal = raw.deal === 'prodazha' ? 'prodazha' : 'arenda'
    const rooms = [...new Set((Array.isArray(raw.rooms) ? raw.rooms : []).map(Number))]
      .filter((r) => Number.isInteger(r) && r >= 1 && r <= 4)
      .sort()
    const params = {
      city: city.id,
      districts,
      deal,
      rooms,
      pages: num(raw.pages, 1, 3, 2),
      drop_pct: num(raw.drop_pct, 2, 50, 7),
      below_pct: num(raw.below_pct, 5, 60, 25)
    }
    const what = deal === 'prodazha' ? 'продажа' : 'аренда'
    const where = districts.length === city.districts.length ? 'все районы' : `${districts.length} р-н.`
    return { params, title: `🏠 ${city.name} · ${what} · ${where}` }
  }

  if (kind === 'kaspi_category') {
    const mode = raw.mode === 'broad' ? 'broad' : 'selected'
    const categories = [...new Set((Array.isArray(raw.categories) ? raw.categories : []).map(String))].filter(
      isValidCategoryCode
    )
    if (mode === 'selected' && !categories.length) throw new BadRequest('выберите хотя бы одну категорию')
    const params = {
      city: city.kaspiCity,
      city_id: city.id,
      mode,
      categories: mode === 'broad' ? [] : categories,
      pages: num(raw.pages, 1, 3, mode === 'broad' ? 1 : 2),
      drop_pct: num(raw.drop_pct, 2, 50, mode === 'broad' ? 15 : 8),
      min_price: num(raw.min_price, 0, 10_000_000, 5000)
    }
    const what =
      mode === 'broad'
        ? 'широкий скан'
        : categories.length === 1
          ? (findKaspiCategory(categories[0])?.name ?? categories[0])
          : `${categories.length} категор.`
    return { params, title: `🛒 Kaspi · ${city.name} · ${what}` }
  }

  throw new BadRequest('kind должен быть krisha_zone или kaspi_category')
}

export function registerDetectorRoutes(app: FastifyInstance, { db, scheduler }: DetectorDeps): void {
  const shapeScan = (w: WatcherRow, counts: Map<number, number>) => ({
    id: w.id,
    kind: w.kind,
    title: w.title,
    params: safeJson<Record<string, unknown>>(w.params_json, {}),
    interval_min: w.interval_min,
    active: Boolean(w.active),
    summary: w.best_title,
    last_level: w.last_level,
    last_error: w.last_error,
    last_run_at: w.last_run_at,
    next_run_at: w.next_run_at,
    ago: timeAgoRu(w.last_run_at),
    anomalies7d: counts.get(w.id) ?? 0
  })

  const counts7d = (): Map<number, number> => {
    const rows = db
      .prepare(
        `SELECT watcher_id, COUNT(*) AS n FROM anomalies WHERE created_at >= datetime('now','-7 days') GROUP BY watcher_id`
      )
      .all() as Array<{ watcher_id: number; n: number }>
    return new Map(rows.map((r) => [r.watcher_id, Number(r.n)]))
  }

  app.get('/api/detector/catalog', async () => ({
    cities: CITIES,
    categories: KASPI_CATEGORIES
  }))

  app.get('/api/detector/scans', async () => {
    const c = counts7d()
    return listWatchers(db)
      .filter((w) => isScanKind(w.kind))
      .map((w) => shapeScan(w, c))
  })

  app.post('/api/detector/scans', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const kind = String(b.kind ?? '')
    try {
      const { params, title } = normalizeScan(kind, (b.params ?? {}) as Record<string, unknown>)
      const w = createWatcher(db, {
        user_id: ensureLocalUser(db),
        kind,
        title: String(b.title ?? '').trim().slice(0, 120) || title,
        url: '',
        params_json: JSON.stringify(params),
        interval_min: Math.round(num(b.interval_min, 15, 1440, 60))
      })
      if (b.run_now !== false && scheduler) void scheduler.runById(w.id).catch(() => {})
      return reply.code(201).send(shapeScan(w, new Map()))
    } catch (e) {
      if (e instanceof BadRequest) return reply.code(400).send({ error: e.message })
      throw e
    }
  })

  app.put('/api/detector/scans/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const w = getWatcher(db, id)
    if (!w || !isScanKind(w.kind)) return reply.code(404).send({ error: 'скан не найден' })
    const b = (req.body ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    try {
      if (b.params !== undefined) {
        const { params, title } = normalizeScan(w.kind, (b.params ?? {}) as Record<string, unknown>)
        patch.params_json = JSON.stringify(params)
        // авто-заголовок обновляется вместе с выбором, ручной — сохраняется
        if (b.title == null && /^(🏠|🛒) /.test(w.title)) patch.title = title
      }
    } catch (e) {
      if (e instanceof BadRequest) return reply.code(400).send({ error: e.message })
      throw e
    }
    if (b.title != null && String(b.title).trim()) patch.title = String(b.title).trim().slice(0, 120)
    if (b.interval_min != null) patch.interval_min = Math.round(num(b.interval_min, 15, 1440, w.interval_min))
    if (b.active != null) patch.active = b.active ? 1 : 0
    updateWatcher(db, id, patch)
    return shapeScan(getWatcher(db, id) as WatcherRow, counts7d())
  })

  app.get('/api/detector/anomalies', async (req) => {
    const q = req.query as { source?: string; zone?: string; watcher?: string; limit?: string }
    const limit = Math.round(num(q.limit, 1, 200, 60))
    return listAnomalies(db, {
      source: q.source === 'krisha' || q.source === 'kaspi' ? q.source : undefined,
      zone: q.zone || undefined,
      watcherId: q.watcher ? Number(q.watcher) : undefined,
      limit
    }).map((a) => ({
      ...a,
      meta_json: undefined,
      meta: safeJson<Record<string, unknown>>(a.meta_json, {}),
      suspicious: Boolean(a.suspicious),
      ago: timeAgoRu(a.created_at.includes('T') ? a.created_at : `${a.created_at.replace(' ', 'T')}Z`)
    }))
  })

  /** Рыночная статистика районов для раскраски карты. */
  app.get('/api/detector/zones', async (req) => {
    const q = req.query as { deal?: string }
    const deal = q.deal === 'prodazha' ? 'prodazha' : 'arenda'
    const byZone = new Map<string, Map<string, { unit: number | null; price: number }>>()
    for (const r of recentScanOffers(db, 'krisha_zone', MARKET_WINDOW_DAYS)) {
      const meta = safeJson<Partial<ScanMeta> & { deal?: string }>(r.meta_json, {})
      if (!meta.zone || meta.deal !== deal || r.price == null) continue
      let m = byZone.get(meta.zone)
      if (!m) byZone.set(meta.zone, (m = new Map()))
      m.set(r.external_id, { unit: meta.unit ?? null, price: r.price })
    }
    const anomalies = anomalyCountsByZone(db, 7)
    const zones: Record<string, { listings: number; medianUnit: number | null; medianPrice: number | null; anomalies7d: number }> = {}
    for (const city of CITIES) {
      for (const d of city.districts) {
        const rows = [...(byZone.get(d.alias)?.values() ?? [])]
        const units = rows.map((r) => r.unit).filter((u): u is number => u != null && u > 0)
        zones[d.alias] = {
          listings: rows.length,
          medianUnit: units.length ? Math.round(median(units)) : null,
          medianPrice: rows.length ? Math.round(median(rows.map((r) => r.price))) : null,
          anomalies7d: anomalies[d.alias] ?? 0
        }
      }
    }
    return { deal, zones }
  })
}
