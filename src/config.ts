import 'dotenv/config'
import path from 'node:path'

export interface Config {
  env: string
  version: string
  brand: string
  port: number
  baseUrl: string
  dataDir: string
  dbPath: string
  adminToken: string | null
  telegramToken: string | null
  tpToken: string | null
  proxies: string[]
  userAgent: string | null
  timezone: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  maxConcurrency: number
  minDelayMs: [number, number]
  /** Разрешить наблюдения за адресами во внутренней сети (по умолчанию нет — защита от SSRF). */
  allowPrivateTargets: boolean
  /** Сколько дней хранить точки истории цен; 0 — не чистить. */
  retentionDays: number
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

function parseLevel(v: string | undefined): Config['logLevel'] {
  const s = (v ?? '').trim().toLowerCase()
  return LOG_LEVELS.has(s) ? (s as Config['logLevel']) : 'info'
}

function parseBool(v: string | undefined, dflt = false): boolean {
  const s = (v ?? '').trim().toLowerCase()
  if (!s) return dflt
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

function parseIntEnv(v: string | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function parseDelay(v: string | undefined): [number, number] {
  const m = (v ?? '').match(/^(\d+)\s*\.\.\s*(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return a <= b ? [a, b] : [b, a]
  }
  if (v && /^\d+$/.test(v)) return [Number(v), Number(v)]
  return [900, 2400]
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = process.env.DATA_DIR ?? path.resolve('data')
  const cfg: Config = {
    env: process.env.NODE_ENV ?? 'development',
    version: '1.0.0',
    brand: process.env.BRAND_NAME ?? 'CheapKZ',
    port: Number(process.env.PORT ?? 8080),
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, ''),
    dataDir,
    dbPath: process.env.DB_PATH ?? path.join(dataDir, 'cheapkz.db'),
    adminToken: process.env.ADMIN_TOKEN?.trim() || null,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
    tpToken: process.env.TRAVELPAYOUTS_TOKEN?.trim() || null,
    proxies: (process.env.PROXIES ?? '')
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    userAgent: process.env.USER_AGENT?.trim() || null,
    timezone: process.env.TZ_NAME ?? 'Asia/Almaty',
    logLevel: parseLevel(process.env.LOG_LEVEL),
    maxConcurrency: parseIntEnv(process.env.MAX_CONCURRENCY, 3, 1, 32),
    minDelayMs: parseDelay(process.env.MIN_DELAY_MS),
    allowPrivateTargets: parseBool(process.env.ALLOW_PRIVATE_TARGETS),
    retentionDays: parseIntEnv(process.env.RETENTION_DAYS, 365, 0, 3650),
    ...overrides
  }
  return cfg
}

export interface ConfigIssue {
  level: 'warn' | 'error'
  text: string
}

/** Проверка конфигурации на старте: явные проблемы лучше увидеть сразу, а не в проде. */
export function validateConfig(cfg: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const prod = cfg.env === 'production'
  if (!cfg.adminToken) {
    issues.push({
      level: prod ? 'error' : 'warn',
      text: 'ADMIN_TOKEN не задан — API открыт только с localhost. Для публичного адреса задайте токен.'
    })
  } else if (cfg.adminToken.length < 16 || cfg.adminToken === 'change-me-to-long-random-string') {
    issues.push({
      level: prod ? 'error' : 'warn',
      text: 'ADMIN_TOKEN слишком короткий или оставлен по умолчанию — сгенерируйте: openssl rand -hex 32'
    })
  }
  if (prod && cfg.baseUrl.startsWith('http://') && !/^https?:\/\/(localhost|127\.)/.test(cfg.baseUrl)) {
    issues.push({ level: 'warn', text: 'BASE_URL без HTTPS — токен панели будет ходить открытым текстом.' })
  }
  if (cfg.minDelayMs[0] > cfg.minDelayMs[1]) {
    issues.push({ level: 'warn', text: 'MIN_DELAY_MS: нижняя граница больше верхней — диапазон будет перевёрнут.' })
  }
  if (cfg.allowPrivateTargets) {
    issues.push({ level: 'warn', text: 'ALLOW_PRIVATE_TARGETS=1 — защита от SSRF отключена.' })
  }
  try {
    for (const p of cfg.proxies) new URL(p)
  } catch {
    issues.push({ level: 'error', text: 'PROXIES содержит невалидный URL — ожидается http://user:pass@host:port' })
  }
  return issues
}
