import { Cron } from 'croner'
import type { Config } from '../config.js'
import {
  dueWatchers,
  findOffer,
  upsertOffer,
  addPoint,
  lastPoint,
  pointHistory,
  insertAlert,
  updateWatcher,
  getWatcher,
  kvGet,
  kvSet,
  cacheGet,
  cacheSet,
  pruneOldData,
  statInc,
  listWatchers,
  getUserById,
  type WatcherRow
} from '../db/index.js'
import { SourceError, HttpGuard } from '../http/client.js'
import { getAdapter } from '../sources/index.js'
import type { Offer } from '../sources/types.js'
import { hotScore } from '../core/hotScore.js'
import { evaluateRules, filtersOf, passesFilters } from '../core/rules.js'
import { buildAlertMessage, ruleLabels } from '../core/format.js'
import type { Notifier } from '../core/notify.js'
import { jitterFactor, nowIso, safeJson, deltaPct } from '../util.js'
import { log } from '../log.js'

export interface Deps {
  cfg: Config
  db: import('../db/index.js').DB
  guard: HttpGuard
  notifier: Notifier
}

const AGG = '*'

/** Полный цикл одного наблюдения: fetch → score → rules → alerts. */
export async function runWatcher(deps: Deps, watcherId: number): Promise<{ offers: number; alerts: number; bestPrice: number | null }> {
  const { db, cfg, guard } = deps
  const w = getWatcher(db, watcherId)
  if (!w) throw new Error(`watcher ${watcherId} не найден`)
  const adapter = getAdapter(w.kind)
  const params = safeJson<Record<string, unknown>>(w.params_json, {})

  let offers
  try {
    offers = await adapter.fetch({
      guard,
      url: w.url,
      params,
      tpToken: cfg.tpToken,
      cache: {
        get: (k) => cacheGet(db, k),
        set: (k, v, ttl) => cacheSet(db, k, v, ttl)
      }
    })
    updateWatcher(db, w.id, { last_error: null })
  } catch (e) {
    const code = e instanceof SourceError ? e.code : 'NETWORK'
    const msg = e instanceof Error ? e.message : String(e)
    updateWatcher(db, w.id, { last_error: `${code}: ${msg}`.slice(0, 300) })
    // при блокировке — увеличенный интервал повторной попытки
    const backoffMin = code === 'BLOCKED' ? Math.max(15, Math.round(w.interval_min * 2)) : Math.max(5, Math.round(w.interval_min / 3))
    scheduleNext(deps.db, w, backoffMin)
    if (code === 'CONFIG') log.warn(`watcher #${w.id}: ${msg}`)
    else log.warn(`watcher #${w.id} (${w.kind}) ошибка: ${msg}`)
    throw e
  }

  // --- фильтры и новые объявления ---
  const filters = filtersOf(params)
  const knownIds = new Set(
    (db.prepare(`SELECT external_id FROM offers WHERE watcher_id=?`).all(w.id) as Array<{ external_id: string }>).map(
      (r) => r.external_id
    )
  )
  const newMatching = offers.filter((o) => !knownIds.has(o.externalId) && passesFilters(o, filters)).slice(0, 10)

  for (const o of offers.slice(0, 200)) {
    upsertOffer(db, {
      watcher_id: w.id,
      external_id: o.externalId,
      title: o.title,
      url: o.url,
      seller: o.seller ?? null,
      price: o.price,
      old_price: o.oldPrice ?? null,
      currency: o.currency ?? 'KZT',
      in_stock: o.inStock === false ? 0 : 1,
      meta_json: JSON.stringify(o.meta ?? {})
    })
  }

  // --- лучшая цена ---
  const priced = offers.filter((o): o is Offer & { price: number } => o.price != null && o.price > 0)
  const best = priced.sort((a, b) => a.price - b.price)[0] ?? offers[0] ?? null

  const prevPoint = lastPoint(db, w.id, AGG)
  const prevPrice = prevPoint?.price ?? null
  // история ДО записи текущей точки — для перцентилей
  const history = pointHistory(db, w.id, 90, AGG)
  let alertsCount = 0

  if (best && best.price != null && best.price > 0) {
    if (prevPrice == null || prevPrice !== best.price) {
      addPoint(db, w.id, AGG, best.price)
    }

    const isNewBest = !knownIds.has(best.externalId)
    const score = hotScore({
      price: best.price,
      oldPrice: best.oldPrice ?? null,
      history,
      isNew: isNewBest
    })

    const results = evaluateRules({
      watcher: { id: w.id, kind: w.kind, target_price: w.target_price, drop_pct: w.drop_pct, params },
      best,
      prevPrice,
      history,
      score,
      newMatching
    })

    const labels = ruleLabels()
    for (const r of results) {
      if (!cooldownOk(deps.db, w.id, r.rule)) continue
      const delta =
        prevPrice != null && best.price < prevPrice ? Number(deltaPct(prevPrice, best.price).toFixed(2)) : null
      const message = buildAlertMessage(
        { watcher: w, offer: r.offer, score, prevPrice },
        labels[r.rule] ?? ''
      )
      insertAlert(db, {
        watcher_id: w.id,
        rule: r.rule,
        level: score.level,
        message,
        price: best.price,
        delta
      })
      setCooldown(deps.db, w.id, r.rule)
      alertsCount++
    }

    updateWatcher(db, w.id, {
      last_price: best.price,
      prev_price: prevPrice,
      last_score: score.score,
      last_level: score.level,
      best_title: best.title?.slice(0, 160) ?? w.best_title,
      best_url: best.url || w.url
    })
    // доставка выполняется отдельным flush-циклом Notifier
  }

  updateWatcher(db, w.id, { last_run_at: nowIso() })
  scheduleNext(db, w, w.interval_min)
  return { offers: offers.length, alerts: alertsCount, bestPrice: best?.price ?? null }
}

function scheduleNext(db: Deps['db'], w: WatcherRow, intervalMin: number): void {
  const ms = Math.max(1, Math.round(intervalMin * jitterFactor() * 60_000))
  updateWatcher(db, w.id, { next_run_at: new Date(Date.now() + ms).toISOString() })
}

const COOLDOWN_HOURS: Record<string, number> = {
  target_hit: 6,
  drop_pct: 6,
  low_percentile: 12,
  new_match: 24
}

function cooldownOk(db: Deps['db'], watcherId: number, rule: string): boolean {
  const until = kvGet(db, `cd:${watcherId}:${rule}`)
  return !until || new Date(until).getTime() <= Date.now()
}

function setCooldown(db: Deps['db'], watcherId: number, rule: string): void {
  const h = COOLDOWN_HOURS[rule] ?? 6
  kvSet(db, `cd:${watcherId}:${rule}`, new Date(Date.now() + h * 3600_000).toISOString())
}

/** Планировщик: тикает каждые 20 секунд, запускает дозревшие наблюдения. */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private digestCron: Cron | null = null
  private running = new Set<number>()
  startedAt = Date.now()

  constructor(private deps: Deps) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 20_000)
    this.timer.unref?.()
    // ретеншен: раз в сутки чистим историю и доставленные алерты
    this.pruneTimer = setInterval(() => this.prune(), 24 * 3600_000)
    this.pruneTimer.unref?.()
    this.prune()
    this.digestCron = new Cron('4 * * * *', { timezone: this.deps.cfg.timezone }, () =>
      void this.deps.notifier.runDigests(this.currentHour())
    )
    log.info('scheduler started', { timezone: this.deps.cfg.timezone, brand: this.deps.cfg.brand })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.timer = null
    this.pruneTimer = null
    this.digestCron?.stop()
  }

  /** Удаление данных старше retentionDays. */
  prune(): number {
    try {
      const n = pruneOldData(this.deps.db, this.deps.cfg.retentionDays)
      if (n > 0) log.info(`ретеншен: удалено ${n} устаревших записей`)
      return n
    } catch (e) {
      log.warn('ретеншен не выполнен', e)
      return 0
    }
  }

  private currentHour(): number {
    const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: this.deps.cfg.timezone, hour: 'numeric', hour12: false })
    return Number(fmt.format(new Date())) % 24
  }

  async tick(limit = 5): Promise<void> {
    const due = dueWatchers(this.deps.db, limit).filter((w) => !this.running.has(w.id))
    // ошибка одного наблюдения не должна ронять тик остальных
    await Promise.all(due.map((w) => this.runTracked(w).catch(() => undefined)))
  }

  stats(): { running: number; due: number; uptimeSec: number } {
    const due = dueWatchers(this.deps.db, 100).length
    return { running: this.running.size, due, uptimeSec: Math.round((Date.now() - this.startedAt) / 1000) }
  }

  /** Ручной запуск по id с проверкой владельца. */
  async runById(id: number, userId?: number): Promise<Awaited<ReturnType<typeof runWatcher>>> {
    const w = getWatcher(this.deps.db, id)
    if (!w) throw new Error('наблюдение не найдено')
    if (userId != null && w.user_id !== userId) throw new Error('нет доступа к этому наблюдению')
    return this.runTracked(w)
  }

  private async runTracked(w: WatcherRow): Promise<Awaited<ReturnType<typeof runWatcher>>> {
    if (this.running.has(w.id)) return { offers: 0, alerts: 0, bestPrice: null }
    this.running.add(w.id)
    try {
      return await runWatcher(this.deps, w.id)
    } finally {
      this.running.delete(w.id)
    }
  }
}

/** Сводка для API/бота. */
export function watcherSummary(deps: Deps, userId?: number) {
  const rows = listWatchers(deps.db, userId)
  return rows.map((w) => ({
    ...w,
    params_json: undefined,
    params: safeJson<Record<string, unknown>>(w.params_json, {}),
    ownerTg: getUserById(deps.db, w.user_id)?.tg_id ?? null
  }))
}
