import { nowIso } from '../util.js'
import type { DB } from '../db/index.js'

export interface ProxyStat {
  url: string
  ok: number
  fail: number
  cooldownSec: number
  dead: boolean
}

const COOLDOWN_STEPS_MS = [60_000, 5 * 60_000, 25 * 60_000, 2 * 3_600_000, 6 * 3_600_000]
const MAX_FAILS = 5

/**
 * Пул прокси с весовым выбором (LRU + успехи/провалы),
 * экспоненциальным cooldown при бане и автоисключением мёртвых.
 */
export class ProxyPool {
  private stats = new Map<
    string,
    { ok: number; fail: number; streak: number; cooldownUntil: number; lastUsed: number }
  >()

  constructor(
    urls: string[],
    private db?: DB | null
  ) {
    for (const u of urls) this.add(u)
    if (db) this.loadFromDb()
  }

  add(url: string): void {
    if (!this.stats.has(url)) {
      this.stats.set(url, { ok: 0, fail: 0, streak: 0, cooldownUntil: 0, lastUsed: 0 })
      if (this.db) {
        this.db
          .prepare(`INSERT OR IGNORE INTO proxies (url) VALUES (?)`)
          .run(url)
      }
    }
  }

  private loadFromDb(): void {
    if (!this.db) return
    const rows = this.db.prepare(`SELECT url FROM proxies`).all() as Array<{ url: string }>
    for (const r of rows) this.add(r.url)
  }

  get size(): number {
    return this.stats.size
  }

  /** Выбор наименее недавно использованного живого прокси; при равном весе — самый «остывший». */
  pick(exclude?: string): string | null {
    const now = Date.now()
    let best: string | null = null
    let bestWeight = -Infinity
    let bestLastUsed = Infinity
    for (const [url, s] of this.stats) {
      if (url === exclude) continue
      if (s.cooldownUntil > now || s.streak >= MAX_FAILS) continue
      const weight = (s.ok + 1) / Math.pow(s.fail + 1, 2)
      if (
        weight > bestWeight ||
        (weight === bestWeight && s.lastUsed < bestLastUsed)
      ) {
        best = url
        bestWeight = weight
        bestLastUsed = s.lastUsed
      }
    }
    if (best) {
      const s = this.stats.get(best)!
      s.lastUsed = now
    }
    return best
  }

  reward(url: string | null): void {
    if (!url) return
    const s = this.stats.get(url)
    if (!s) return
    s.ok++
    s.streak = 0
    s.cooldownUntil = 0
    this.persist(url, s)
  }

  /** Провал: рост cooldown по шагам, после MAX_FAILS подряд — исключение из ротации. */
  penalize(url: string | null, now = Date.now()): void {
    if (!url) return
    const s = this.stats.get(url)
    if (!s) return
    s.fail++
    s.streak++
    const step = Math.min(s.streak - 1, COOLDOWN_STEPS_MS.length - 1)
    if (step >= 0) s.cooldownUntil = now + COOLDOWN_STEPS_MS[step]
    this.persist(url, s)
  }

  aliveCount(now = Date.now()): number {
    let n = 0
    for (const s of this.stats.values()) if (s.cooldownUntil <= now && s.streak < MAX_FAILS) n++
    return n
  }

  snapshot(): ProxyStat[] {
    const now = Date.now()
    return [...this.stats.entries()].map(([url, s]) => ({
      url,
      ok: s.ok,
      fail: s.fail,
      cooldownSec: s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0,
      dead: s.streak >= MAX_FAILS
    }))
  }

  private persist(url: string, s: { ok: number; fail: number; streak: number; cooldownUntil: number }): void {
    if (!this.db) return
    try {
      this.db
        .prepare(
          `UPDATE proxies SET ok_count=?, fail_count=?, fail_streak=?, cooldown_until=?, last_used_at=? WHERE url=?`
        )
        .run(s.ok, s.fail, s.streak, s.cooldownUntil ? new Date(s.cooldownUntil).toISOString() : null, nowIso(), url)
    } catch {
      /* статистика не критична */
    }
  }
}
