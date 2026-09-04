import { sleep } from '../util.js'

export interface LimiterOpts {
  capacity: number
  refillMs: number
  maxConcurrent: number
  jitterMs: [number, number]
  rng?: () => number
  hostOverrides?: Record<string, { refillMs?: number; capacity?: number }>
}

interface Bucket {
  tokens: number
  updated: number
}

/**
 * Вежливый лимитер: token bucket на хост + глобальное ограничение параллелизма
 * + случайная задержка (jitter), чтобы поведение не было машинным.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private running = 0
  private waiters: Array<() => void> = []
  private rng: () => number

  constructor(private o: LimiterOpts) {
    this.rng = o.rng ?? Math.random
  }

  private hostCfg(host: string): { capacity: number; refillMs: number } {
    const ov = this.o.hostOverrides?.[host] ?? {}
    return {
      capacity: ov.capacity ?? this.o.capacity,
      refillMs: ov.refillMs ?? this.o.refillMs
    }
  }

  /** Возвращает функцию освобождения слота. Обязательно вызвать после завершения запроса. */
  async acquire(host: string): Promise<() => void> {
    await this.takeToken(host)
    await this.takeSlot()
    const [a, b] = this.o.jitterMs
    await sleep(a + Math.floor(this.rng() * (b - a + 1)))
    return () => this.release()
  }

  private async takeToken(host: string): Promise<void> {
    for (;;) {
      const c = this.hostCfg(host)
      const now = Date.now()
      let b = this.buckets.get(host)
      if (!b) {
        b = { tokens: c.capacity, updated: now }
        this.buckets.set(host, b)
      }
      b.tokens = Math.min(c.capacity, b.tokens + (now - b.updated) / c.refillMs)
      b.updated = now
      if (b.tokens >= 1) {
        b.tokens -= 1
        return
      }
      await sleep((1 - b.tokens) * c.refillMs + 5)
    }
  }

  private takeSlot(): Promise<void> {
    if (this.running < this.o.maxConcurrent) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>((res) => this.waiters.push(res))
  }

  /** При передаче слота ожидающему счётчик не уменьшается — слот переезжает. */
  private release(): void {
    const w = this.waiters.shift()
    if (w) w()
    else this.running--
  }

  stats(): { running: number; queued: number; hosts: number } {
    return { running: this.running, queued: this.waiters.length, hosts: this.buckets.size }
  }
}

/** Circuit breaker на домен: при серии блокировок пауза, чтобы не долбить бан. */
export class Breaker {
  private st = new Map<string, { fails: number; until: number }>()

  constructor(
    private threshold = 4,
    private openMs = 60_000,
    private maxOpenMs = 30 * 60_000
  ) {}

  can(host: string, now = Date.now()): boolean {
    const s = this.st.get(host)
    return !s || s.until <= now
  }

  retryAfter(host: string, now = Date.now()): number {
    const s = this.st.get(host)
    if (!s || s.until <= now) return 0
    return Math.ceil((s.until - now) / 1000)
  }

  fail(host: string, now = Date.now()): void {
    const s = this.st.get(host) ?? { fails: 0, until: 0 }
    s.fails += 1
    const over = s.fails - this.threshold
    s.until =
      over >= 0 ? now + Math.min(this.openMs * 2 ** over, this.maxOpenMs) : s.until
    this.st.set(host, s)
  }

  success(host: string): void {
    this.st.delete(host)
  }

  snapshot(): Array<{ host: string; fails: number; openSec: number }> {
    const now = Date.now()
    return [...this.st.entries()].map(([host, s]) => ({
      host,
      fails: s.fails,
      openSec: s.until > now ? Math.ceil((s.until - now) / 1000) : 0
    }))
  }
}
