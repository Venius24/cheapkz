import { deltaPct } from '../util.js'
import { percentileRank, type ScoreResult } from './hotScore.js'
import type { Offer } from '../sources/types.js'

export interface WatcherFilters {
  require?: string[]
  exclude?: string[]
  min_price?: number | null
  max_price?: number | null
}

export interface RuleContext {
  watcher: {
    id: number
    kind: string
    target_price: number | null
    drop_pct: number | null
    params: Record<string, unknown>
  }
  best: Offer
  prevPrice: number | null
  history: number[]
  score: ScoreResult
  /** Новые объявления (первое появление), прошедшие фильтры */
  newMatching: Offer[]
  currency?: string
}

export interface RuleResult {
  rule: 'target_hit' | 'drop_pct' | 'low_percentile' | 'new_match'
  level: ScoreResult['level']
  offer: Offer
}

/** Фильтр объявлений по ключевым словам и цене. */
export function passesFilters(o: Offer, f: WatcherFilters): boolean {
  const title = (o.title ?? '').toLowerCase()
  if (f.require?.length) {
    for (const r of f.require) {
      const words = r.toLowerCase().split(/\s+/).filter(Boolean)
      if (!words.every((w) => title.includes(w))) return false
    }
  }
  if (f.exclude?.length && f.exclude.some((x) => title.includes(x.toLowerCase()))) return false
  const p = o.price ?? -Infinity
  if (f.min_price != null && p < f.min_price) return false
  if (f.max_price != null && p > f.max_price) return false
  return true
}

export function filtersOf(params: Record<string, unknown>): WatcherFilters {
  const f = params.filters as WatcherFilters | undefined
  return f ?? {}
}

/**
 * Чистая функция оценки алертов. Коолдауны — ответственность вызывающего кода.
 */
export function evaluateRules(ctx: RuleContext): RuleResult[] {
  const out: RuleResult[] = []
  const price = ctx.best.price
  const w = ctx.watcher

  // 1. Целевая цена
  if (price != null && w.target_price != null && price <= w.target_price) {
    out.push({ rule: 'target_hit', level: ctx.score.level === 'cool' ? 'warm' : ctx.score.level, offer: ctx.best })
  }

  // 2. Падение на drop_pct относительно прошлого замера
  if (
    price != null &&
    ctx.prevPrice != null &&
    ctx.prevPrice > 0 &&
    w.drop_pct != null &&
    w.drop_pct > 0 &&
    ctx.prevPrice > price &&
    deltaPct(ctx.prevPrice, price) >= w.drop_pct
  ) {
    out.push({ rule: 'drop_pct', level: ctx.score.level === 'cool' ? 'warm' : ctx.score.level, offer: ctx.best })
  }

  // 3. Исторически низкая цена (перцентиль ≤ 10%, истории ≥ 10 точек)
  if (price != null && ctx.history.length >= 10 && percentileRank(ctx.history, price) <= 0.1) {
    out.push({ rule: 'low_percentile', level: ctx.score.level === 'hot' ? 'hot' : 'warm', offer: ctx.best })
  }

  // 4. Новые объявления по фильтрам (для поисковых типов; для Kaspi — только если явно включено)
  const allowNewMatch = w.kind !== 'kaspi' || Boolean(w.params.alert_new_merchant)
  if (allowNewMatch) {
    for (const o of ctx.newMatching.slice(0, 3)) {
      out.push({ rule: 'new_match', level: 'cool', offer: o })
    }
  }

  return out
}
