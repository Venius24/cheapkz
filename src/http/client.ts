import { request, ProxyAgent } from 'undici'
import { Breaker, RateLimiter } from './limiter.js'
import { ProxyPool } from './proxies.js'
import { SourceError } from './errors.js'
import { assertPublicUrl } from './safeUrl.js'
import type { Config } from '../config.js'
import { statInc } from '../db/index.js'
import type { DB } from '../db/index.js'
import { randInt, redact } from '../util.js'

export { SourceError } from './errors.js'
export type { SourceErrorCode } from './errors.js'

export interface FetchResult {
  status: number
  body: string
  ms: number
  viaProxy: string | null
  /** Финальный URL после редиректов. */
  url: string
}

export interface GetOpts {
  headers?: Record<string, string>
  timeoutMs?: number
  /** Число попыток (каждая — через свой выход в сеть). */
  retries?: number
  /** Максимум байт тела; лишнее отбрасывается, чтобы гигантская страница не съела память. */
  maxBytes?: number
}

const CAPTCHA_MARKERS = [
  'captcha',
  'cf-browser-verification',
  'cf-chl',
  'ddos-guard',
  'just a moment',
  'access denied',
  'доступ ограничен',
  'подтвердите, что вы не робот'
]

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
]

const MAX_REDIRECTS = 4
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

export function isCaptcha(body: string): boolean {
  const head = body.slice(0, 4096).toLowerCase()
  return CAPTCHA_MARKERS.some((m) => head.includes(m))
}

/**
 * HttpGuard — единственная точка выхода в интернет для всех адаптеров.
 * Лимитер + jitter + прокси + circuit breaker + ретраи на другом выходе.
 */
export class HttpGuard {
  private limiter: RateLimiter
  private breaker = new Breaker()
  private pool: ProxyPool
  private agents = new Map<string, ProxyAgent>()
  /** кольцевой буфер последних запросов для метрик */
  private recent: Array<{ host: string; ms: number; status: number }> = []
  requestsTotal = 0
  blockedTotal = 0

  constructor(
    private cfg: Config,
    private db: DB,
    pool?: ProxyPool,
    /** Базовые параметры лимитера; переопределяются для тестов и тонкой настройки. */
    limiter: { capacity?: number; refillMs?: number } = {}
  ) {
    this.pool = pool ?? new ProxyPool(cfg.proxies)
    const overrides: Record<string, { refillMs?: number; capacity?: number }> = {
      'kaspi.kz': { refillMs: 4000, capacity: 2 },
      'www.olx.kz': { refillMs: 3500, capacity: 2 },
      'olx.kz': { refillMs: 3500, capacity: 2 },
      'krisha.kz': { refillMs: 5000, capacity: 2 },
      'api.travelpayouts.com': { refillMs: 1200, capacity: 3 }
    }
    this.limiter = new RateLimiter({
      capacity: limiter.capacity ?? 3,
      refillMs: limiter.refillMs ?? 3000,
      maxConcurrent: cfg.maxConcurrency,
      jitterMs: cfg.minDelayMs,
      hostOverrides: overrides
    })
  }

  get proxies(): ProxyPool {
    return this.pool
  }

  breakerSnapshot(): Array<{ host: string; fails: number; openSec: number }> {
    return this.breaker.snapshot()
  }

  recentRequests(): Array<{ host: string; ms: number; status: number }> {
    return [...this.recent]
  }

  /** Закрывает keep-alive соединения прокси-агентов при остановке процесса. */
  async close(): Promise<void> {
    const agents = [...this.agents.values()]
    this.agents.clear()
    await Promise.all(agents.map((a) => a.close().catch(() => {})))
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const ua = this.cfg.userAgent ?? UAS[randInt(0, UAS.length - 1)]
    return {
      'user-agent': ua,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'ru-RU,ru;q=0.9,kk;q=0.8,en-US;q=0.7,en;q=0.6',
      'cache-control': 'no-cache',
      ...extra
    }
  }

  private agent(proxyUrl: string): ProxyAgent {
    let a = this.agents.get(proxyUrl)
    if (!a) {
      a = new ProxyAgent(proxyUrl)
      this.agents.set(proxyUrl, a)
    }
    return a
  }

  /**
   * Один запрос со следованием редиректам вручную: `maxRedirections` у undici
   * не работает с кастомным dispatcher'ом (ProxyAgent) и убран в v7,
   * а каждый хоп всё равно нужно проверять на SSRF.
   */
  private async fetchOnce(
    startUrl: string,
    proxy: string | null,
    opts: GetOpts
  ): Promise<{ status: number; body: string; url: string }> {
    let current = startUrl
    const deadline = Date.now() + (opts.timeoutMs ?? 20_000)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current, this.cfg.allowPrivateTargets)
      const left = deadline - Date.now()
      if (left <= 0) throw new SourceError('таймаут запроса', 'NETWORK')
      const res = await request(current, {
        dispatcher: proxy ? this.agent(proxy) : undefined,
        headers: this.headers(opts.headers),
        signal: AbortSignal.timeout(left)
      })
      const loc = res.headers.location
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        await res.body.dump().catch(() => {})
        current = new URL(Array.isArray(loc) ? loc[0] : loc, current).toString()
        continue
      }
      return { status: res.statusCode, body: await readBody(res.body, opts.maxBytes ?? DEFAULT_MAX_BYTES), url: current }
    }
    throw new SourceError(`слишком много редиректов (>${MAX_REDIRECTS})`, 'NETWORK')
  }

  async getText(url: string, opts: GetOpts = {}): Promise<FetchResult> {
    const parsed = await assertPublicUrl(url, this.cfg.allowPrivateTargets)
    const host = parsed.hostname
    const safeUrl = redact(url)
    if (!this.breaker.can(host)) {
      this.blockedTotal++
      statInc(this.db, 'stat:blocked')
      throw new SourceError(
        `домен ${host} временно приостановлен (circuit breaker, ${this.breaker.retryAfter(host)}с)`,
        'BLOCKED'
      )
    }
    const retries = Math.max(1, opts.retries ?? 2)
    let lastErr: SourceError = new SourceError(`не удалось получить ${safeUrl}`, 'NETWORK')
    let lastProxy: string | null = null

    for (let attempt = 0; attempt < retries; attempt++) {
      const release = await this.limiter.acquire(host)
      // на повторе исключаем прокси, на котором только что получили отказ
      const proxy = this.pool.pick(attempt > 0 ? lastProxy ?? undefined : undefined)
      lastProxy = proxy
      const t0 = Date.now()
      let released = false
      try {
        const res = await this.fetchOnce(url, proxy, opts)
        const ms = Date.now() - t0
        release()
        released = true
        this.requestsTotal++
        this.pushRecent(host, ms, res.status)
        statInc(this.db, 'stat:requests')

        if (res.status === 404) {
          this.breaker.success(host)
          throw new SourceError(`страница не найдена (404): ${safeUrl}`, 'NOT_FOUND')
        }
        if (res.status === 403 || res.status === 429 || isCaptcha(res.body)) {
          this.pool.penalize(proxy)
          this.breaker.fail(host)
          this.blockedTotal++
          statInc(this.db, 'stat:blocked')
          lastErr = new SourceError(`запрос заблокирован (${res.status}), смена выхода…`, 'BLOCKED')
          continue
        }
        if (res.status >= 500) {
          this.pool.penalize(proxy)
          lastErr = new SourceError(`сервер источника недоступен (${res.status})`, 'NETWORK')
          continue
        }
        if (res.status >= 400) {
          this.breaker.success(host)
          throw new SourceError(`источник ответил ${res.status} на ${safeUrl}`, 'NOT_FOUND')
        }
        this.pool.reward(proxy)
        this.breaker.success(host)
        return { status: res.status, body: res.body, ms, viaProxy: proxy, url: res.url }
      } catch (e) {
        if (!released) release()
        if (e instanceof SourceError) {
          if (e.code === 'NOT_FOUND' || e.code === 'CONFIG') throw e
          lastErr = e
          continue
        }
        // сетевая ошибка / таймаут
        this.pool.penalize(proxy)
        lastErr = new SourceError(
          `сеть: ${redact(e instanceof Error ? e.message.split('\n')[0] : String(e))}`,
          'NETWORK'
        )
      }
    }
    throw lastErr
  }

  async getJson<T>(url: string, opts: GetOpts = {}): Promise<T> {
    const r = await this.getText(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } })
    try {
      return JSON.parse(r.body) as T
    } catch {
      throw new SourceError('ответ не является корректным JSON', 'PARSE')
    }
  }

  private pushRecent(host: string, ms: number, status: number): void {
    this.recent.push({ host, ms, status })
    if (this.recent.length > 100) this.recent.shift()
  }
}

/** Читает тело с жёстким лимитом — защита от бесконечных/огромных ответов. */
async function readBody(body: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of body) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c as string)
    size += buf.length
    if (size > maxBytes) {
      chunks.push(buf.subarray(0, buf.length - (size - maxBytes)))
      ;(body as { destroy?: () => void }).destroy?.()
      break
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}
