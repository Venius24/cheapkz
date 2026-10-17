import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Config } from '../config.js'
import {
  createWatcher,
  deleteWatcherCascade,
  getWatcher,
  listWatchers,
  updateWatcher,
  pointSeries,
  recentAlerts,
  alertsCountSince,
  savingsSince,
  hotCountSince,
  countOffersSince,
  kvAllPrefix,
  kvSet,
  kvDeletePrefix,
  ensureLocalUser,
  statGetNum,
  type DB
} from '../db/index.js'
import { HttpGuard } from '../http/client.js'
import { detectKind } from '../sources/index.js'
import { isScanKind } from '../sources/scan.js'
import { registerDetectorRoutes } from './detector.js'
import type { Scheduler } from '../worker/index.js'
import { slope, timeAgoRu } from '../util.js'

export interface AppDeps {
  cfg: Config
  db: DB
  guard: HttpGuard
  scheduler: Scheduler | null
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const KINDS = new Set(['kaspi', 'olx', 'krisha', 'flights', 'generic'])
const SETTING_KEYS = new Set(['default_interval_min', 'quiet_from', 'quiet_to'])

/**
 * Сравнение через SHA-256: буферы всегда одной длины (timingSafeEqual падает
 * на разной) и время ответа не выдаёт длину настоящего токена.
 */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function authorized(req: FastifyRequest, cfg: Config): boolean {
  if (!cfg.adminToken) {
    const ip = req.ip.replace('::ffff:', '')
    return ip === '127.0.0.1' || ip === '::1'
  }
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : new URLSearchParams(req.url.split('?')[1] ?? '').get('token') ?? ''
  if (!token) return false
  return sameSecret(token, cfg.adminToken)
}

export function createApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  const { db, cfg, guard, scheduler } = deps

  app.register(cors, { origin: true })

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api') && url !== '/metrics') return
    if (url === '/health') return
    if (!authorized(req, cfg)) {
      return reply.code(401).send({ error: 'unauthorized: задайте заголовок Authorization: Bearer <ADMIN_TOKEN>' })
    }
  })

  // ---------- служебные ----------
  app.get('/health', async () => ({ ok: true, version: cfg.version, brand: cfg.brand, uptimeSec: Math.round(process.uptime()) }))

  app.get('/api/system', async () => ({
    brand: cfg.brand,
    version: cfg.version,
    timezone: cfg.timezone,
    uptimeSec: Math.round(process.uptime()),
    tokens: { telegram: Boolean(cfg.telegramToken), travelpayouts: Boolean(cfg.tpToken), admin: Boolean(cfg.adminToken) },
    proxies: guard.proxies.snapshot(),
    breakers: guard.breakerSnapshot(),
    scheduler: scheduler ? scheduler.stats() : null,
    requestsTotal: statGetNum(db, 'stat:requests'),
    blockedTotal: statGetNum(db, 'stat:blocked')
  }))

  app.get('/metrics', async (_req, reply) => {
    const watchers = listWatchers(db)
    const active = watchers.filter((w) => w.active).length
    const recent = guard.recentRequests()
    const sorted = [...recent].map((r) => r.ms).sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    const byLevel = { hot: 0, warm: 0, cool: 0 }
    for (const w of watchers) {
      if (w.last_level && w.last_level in byLevel) byLevel[w.last_level as keyof typeof byLevel]++
    }
    const metrics: Array<[name: string, type: 'gauge' | 'counter', help: string, value: number]> = [
      ['cheapkz_watchers_total', 'gauge', 'Всего наблюдений', watchers.length],
      ['cheapkz_watchers_active', 'gauge', 'Активных наблюдений', active],
      ['cheapkz_alerts_24h', 'gauge', 'Алертов за последние 24 часа', alertsCountSince(db, iso24hAgo())],
      ['cheapkz_hot_watchers', 'gauge', 'Наблюдений в статусе hot', byLevel.hot],
      ['cheapkz_warm_watchers', 'gauge', 'Наблюдений в статусе warm', byLevel.warm],
      ['cheapkz_requests_total', 'counter', 'Исходящих HTTP-запросов к источникам', statGetNum(db, 'stat:requests')],
      ['cheapkz_blocked_total', 'counter', 'Ответов-блокировок (403/429/капча)', statGetNum(db, 'stat:blocked')],
      ['cheapkz_scrape_ms_p50', 'gauge', 'Медиана времени запроса к источнику, мс', p50],
      ['cheapkz_scrape_ms_p95', 'gauge', '95-й перцентиль времени запроса, мс', p95],
      ['cheapkz_proxies_alive', 'gauge', 'Живых прокси в пуле', guard.proxies.aliveCount()],
      ['cheapkz_uptime_seconds', 'gauge', 'Аптайм процесса, секунды', Math.round(process.uptime())]
    ]
    const body = metrics
      .map(([name, type, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`)
      .join('\n')
    void reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
    return `${body}\n`
  })

  // ---------- статистика ----------
  app.get('/api/stats', async () => {
    const watchers = listWatchers(db)
    return {
      watchers: watchers.length,
      active: watchers.filter((w) => w.active).length,
      hot: watchers.filter((w) => w.last_level === 'hot' && w.active).length,
      alerts24h: alertsCountSince(db, iso24hAgo()),
      offers24h: countOffersSince(db, iso24hAgo()),
      hotAlerts24h: hotCountSince(db, iso24hAgo()),
      savings24h: Math.round(savingsSince(db, iso24hAgo()))
    }
  })

  // ---------- detect ----------
  app.get('/api/detect', async (req) => {
    const { url } = req.query as { url?: string }
    if (!url) return { ok: false, hint: 'нужен параметр url' }
    const kind = detectKind(url)
    try {
      new URL(url)
    } catch {
      return { ok: false, hint: 'невалидный URL' }
    }
    return { ok: true, kind, hint: kindHints(kind) }
  })

  // ---------- watchers ----------
  app.get('/api/watchers', async () => listWatchers(db).map(shapeWatcher))

  app.post('/api/watchers', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const rawUrl = String(b.url ?? '').trim()
    let kind = String(b.kind ?? '') || detectKind(rawUrl)
    if (!KINDS.has(kind)) return reply.code(400).send({ error: `kind должен быть одним из: ${[...KINDS].join(', ')}` })

    let url = rawUrl
    if (kind !== 'flights') {
      try {
        url = new URL(rawUrl).toString()
      } catch {
        return reply.code(400).send({ error: 'невалидный url' })
      }
      if (!url) return reply.code(400).send({ error: 'url обязателен' })
      const params = (b.params ?? {}) as Record<string, unknown>
      if (kind === 'generic' && !params.selector && !b.selector) {
        return reply.code(400).send({ error: 'для универсального источника нужен params.selector (CSS-селектор цены)' })
      }
    }

    const userId = Number(b.user_id ?? ensureLocalUser(db))

    const w = createWatcher(db, {
      user_id: userId,
      kind,
      title: String(b.title ?? defaultTitle(kind, url)).slice(0, 120),
      url,
      params_json: JSON.stringify((b.params as object) ?? {}),
      target_price: numOrNull(b.target_price),
      drop_pct: numOrNull(b.drop_pct),
      interval_min: clampInt(b.interval_min, 5, 1440, Number(kvAllPrefix(db, 'setting.').default_interval_min ?? 30))
    })
    if (b.run_now !== false && scheduler) void scheduler.runById(w.id).catch(() => {})
    return reply.code(201).send(shapeWatcher(w))
  })

  app.patch('/api/watchers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const w = getWatcher(db, id)
    if (!w) return reply.code(404).send({ error: 'не найдено' })
    const b = (req.body ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (b.title != null) patch.title = String(b.title).slice(0, 120)
    if (b.url != null) patch.url = String(b.url)
    if (b.params !== undefined) patch.params_json = JSON.stringify(b.params ?? {})
    if ('target_price' in b) patch.target_price = numOrNull(b.target_price)
    if ('drop_pct' in b) patch.drop_pct = numOrNull(b.drop_pct)
    if (b.interval_min != null) patch.interval_min = clampInt(b.interval_min, 5, 1440, w.interval_min)
    if (b.active != null) patch.active = b.active ? 1 : 0
    updateWatcher(db, id, patch)
    return shapeWatcher(getWatcher(db, id) as NonNullable<ReturnType<typeof getWatcher>>)
  })

  app.delete('/api/watchers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!deleteWatcherCascade(db, id)) return reply.code(404).send({ error: 'не найдено' })
    return { deleted: id }
  })

  app.post('/api/watchers/:id/run', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!scheduler) return reply.code(503).send({ error: 'планировщик не запущен' })
    if (!getWatcher(db, id)) return reply.code(404).send({ error: 'не найдено' })
    let timer: NodeJS.Timeout | undefined
    try {
      const r = await Promise.race([
        scheduler.runById(id),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('таймаут проверки')), 60_000)
        })
      ])
      return { ...r, watcher: shapeWatcher(getWatcher(db, id) as NonNullable<ReturnType<typeof getWatcher>>) }
    } catch (e) {
      return reply.code(422).send({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      clearTimeout(timer)
    }
  })

  app.get('/api/watchers/:id/history', async (req) => {
    const id = Number((req.params as { id: string }).id)
    const days = clampInt((req.query as { days?: string }).days, 1, 365, 30)
    const series = pointSeries(db, id, days)
    const values = series.map((p) => p.p)
    const s = slope(values)
    return {
      series,
      trend: values.length < 2 ? 'unknown' : s < -0.5 ? 'down' : s > 0.5 ? 'up' : 'flat',
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null
    }
  })

  // ---------- алерты / сделки ----------
  app.get('/api/alerts', async (req) => {
    const limit = clampInt((req.query as { limit?: string }).limit, 1, 200, 30)
    return recentAlerts(db, limit).map((a) => {
      const w = getWatcher(db, a.watcher_id)
      return { ...a, watcher_title: w?.title, watcher_kind: w?.kind, ago: timeAgoRu(a.created_at) }
    })
  })

  app.get('/api/deals', async (req) => {
    const q = req.query as { level?: string; kind?: string; limit?: string }
    const limit = clampInt(q.limit, 1, 200, 100)
    // сканы детектора не имеют «лучшей цены» — их находки живут в /api/detector/anomalies
    let rows = listWatchers(db).filter((w) => w.last_price != null && !isScanKind(w.kind))
    if (q.level) rows = rows.filter((w) => w.last_level === q.level)
    if (q.kind) rows = rows.filter((w) => w.kind === q.kind)
    rows.sort((a, b) => (b.last_score ?? 0) - (a.last_score ?? 0))
    return rows.slice(0, limit).map((w) => ({
      id: w.id,
      title: w.best_title ?? w.title,
      kind: w.kind,
      price: w.last_price,
      prev: w.prev_price,
      score: w.last_score,
      level: w.last_level,
      url: w.best_url ?? w.url,
      checkedAt: w.last_run_at,
      ago: timeAgoRu(w.last_run_at)
    }))
  })

  // ---------- детектор аномалий ----------
  registerDetectorRoutes(app, { db, scheduler })

  // ---------- настройки ----------
  app.get('/api/settings', async () => kvAllPrefix(db, 'setting.'))

  app.put('/api/settings', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(b)) {
      if (!SETTING_KEYS.has(k)) continue
      kvSet(db, `setting.${k}`, v == null ? '' : String(v))
    }
    return kvAllPrefix(db, 'setting.')
  })

  app.post('/api/admin/clear-cache', async (_req, reply) => {
    kvDeletePrefix(db, 'cd:')
    kvDeletePrefix(db, 'og:')
    reply.send({ ok: true, cleared: ['cooldowns', 'titles'] })
  })

  // ---------- SPA ----------
  // dist/web лежит рядом со скомпилированным сервером (dist/api/app.js -> ../web)
  const nearModule = path.resolve(moduleDir, '../web')
  const distWeb = fs.existsSync(nearModule) ? nearModule : path.resolve('dist/web')
  const indexPath = path.join(distWeb, 'index.html')
  let indexCache: Buffer | null = null

  if (fs.existsSync(distWeb)) {
    void app.register(fastifyStatic, { root: distWeb, prefix: '/', index: false, decorateReply: false })
  }

  const sendIndex = (reply: FastifyReply) => {
    if (indexCache == null && fs.existsSync(indexPath)) indexCache = fs.readFileSync(indexPath)
    if (indexCache) return reply.type('text/html; charset=utf-8').send(indexCache)
    return reply.code(503).send('Веб-панель не собрана. Выполните: npm run build')
  }

  // статика с index: false отвечает на «/» 403 (это каталог), поэтому корень — явно
  app.get('/', async (_req, reply) => sendIndex(reply))

  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url.split('?')[0]
    if (req.method === 'GET' && !url.startsWith('/api') && !url.startsWith('/metrics')) return sendIndex(reply)
    return reply.code(404).send({ error: 'not found' })
  })

  // ---------- helpers ----------
  function shapeWatcher(w: NonNullable<ReturnType<typeof getWatcher>>) {
    return {
      id: w.id,
      kind: w.kind,
      title: w.title,
      url: w.url,
      params: safeJsonOf(w.params_json),
      target_price: w.target_price,
      drop_pct: w.drop_pct,
      interval_min: w.interval_min,
      active: Boolean(w.active),
      last_price: w.last_price,
      prev_price: w.prev_price,
      last_score: w.last_score,
      last_level: w.last_level,
      best_title: w.best_title,
      best_url: w.best_url,
      last_error: w.last_error,
      last_run_at: w.last_run_at,
      next_run_at: w.next_run_at,
      created_at: w.created_at
    }
  }

  function defaultTitle(kind: string, url: string): string {
    if (kind === 'flights') return 'Авиабилеты'
    try {
      const u = new URL(url)
      return u.hostname.replace('www.', '')
    } catch {
      return url.slice(0, 60)
    }
  }

  return app
}

function kindHints(kind: string): string {
  switch (kind) {
    case 'kaspi':
      return 'товар Kaspi — можно задать city в params (710000000 Алматы, 750000000 Астана)'
    case 'olx':
      return 'поиск OLX — query берётся из ссылки /q-…/, опционально category_id/region_id'
    case 'krisha':
      return 'выдача Krisha.kz — ссылка на страницу поиска аренды/продажи'
    case 'flights':
      return 'билеты: params.origin/destination (IATA), depart_date/return_date'
    default:
      return 'универсальный источник: params.selector — CSS-селектор цены'
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return Math.round(dflt)
  return Math.min(hi, Math.max(lo, n))
}

function safeJsonOf(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

function iso24hAgo(): string {
  return new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
}
