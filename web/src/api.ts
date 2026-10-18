export interface Watcher {
  id: number
  kind: string
  title: string
  url: string
  params: Record<string, unknown>
  target_price: number | null
  drop_pct: number | null
  interval_min: number
  active: boolean
  last_price: number | null
  prev_price: number | null
  last_score: number | null
  last_level: string | null
  best_title: string | null
  best_url: string | null
  last_error: string | null
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
}

export interface Deal {
  id: number
  title: string
  kind: string
  price: number | null
  prev: number | null
  score: number | null
  level: string | null
  url: string
  checkedAt: string | null
  ago: string
}

export interface Stats {
  watchers: number
  active: number
  hot: number
  alerts24h: number
  offers24h: number
  hotAlerts24h: number
  savings24h: number
}

export interface AlertRow {
  id: number
  watcher_id: number
  rule: string
  level: string
  message: string
  price: number | null
  delta: number | null
  created_at: string
  watcher_title?: string
  watcher_kind?: string
  ago: string
}

export interface SystemInfo {
  brand: string
  version: string
  timezone: string
  uptimeSec: number
  tokens: { telegram: boolean; travelpayouts: boolean; admin: boolean }
  proxies: Array<{ url: string; ok: number; fail: number; cooldownSec: number; dead: boolean }>
  breakers: Array<{ host: string; fails: number; openSec: number }>
  scheduler: { running: number; due: number; uptimeSec: number } | null
  requestsTotal: number
  blockedTotal: number
}

export interface HistoryResp {
  series: Array<{ t: string; p: number }>
  trend: 'down' | 'flat' | 'up' | 'unknown'
  min: number | null
  max: number | null
}

const TOKEN_KEY = 'ck_token'

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null): void => {
    try {
      if (v == null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* приватный режим — живём без памяти */
    }
  }
}

export const getToken = (): string => store.get(TOKEN_KEY) ?? ''
export const setToken = (t: string): void => store.set(TOKEN_KEY, t)
export const clearToken = (): void => store.set(TOKEN_KEY, null)

// ---------- Telegram Mini App ----------
/** initData, с которым Telegram открыл панель; см. tg.ts — читается до того, как роутер перепишет hash. */
export const tgInitData = (): string => {
  try {
    return sessionStorage.getItem('ck_tg_init') ?? ''
  } catch {
    return ''
  }
}
export const inTelegram = (): boolean => tgInitData() !== ''

/** status 0 — сервер недоступен или не ответил вовремя. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
  get unauthorized(): boolean {
    return this.status === 401
  }
  get offline(): boolean {
    return this.status === 0
  }
}

/** Сигнал приложению: токен больше не принимают — пора на экран входа. */
export const UNAUTHORIZED_EVENT = 'ck:unauthorized'

const DEFAULT_TIMEOUT_MS = 15_000

async function request<T>(path: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        ...(init.body != null ? { 'content-type': 'application/json' } : {}),
        authorization: inTelegram() ? `tma ${tgInitData()}` : `Bearer ${getToken()}`,
        ...(init.headers ?? {})
      }
    })
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === 'AbortError'
    throw new ApiError(timeout ? 'сервер не ответил вовремя' : 'нет связи с сервером', 0)
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError('нужен вход', 401)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(String((body as { error?: string }).error ?? `ошибка сервера ${res.status}`), res.status)
  }
  return (await res.json()) as T
}

export interface Me {
  brand: string
  timezone: string
  version: string
  botEnabled: boolean
  mode: 'admin' | 'telegram'
  user: null | {
    id: number
    username: string | null
    quiet_from: string | null
    quiet_to: string | null
    digest_hour: number | null
    muted_until: string | null
    break_quiet_on_hot: boolean
  }
}

/** Проверка входа без побочного события 401 — для экрана логина. */
export async function checkToken(token: string): Promise<'ok' | 'bad' | 'offline'> {
  try {
    const r = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
    return r.ok ? 'ok' : r.status === 401 ? 'bad' : 'offline'
  } catch {
    return 'offline'
  }
}

export const api = {
  me: () => request<Me>('/api/me'),
  patchMe: (payload: Record<string, unknown>) => request<Me>('/api/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  stats: () => request<Stats>('/api/stats'),
  system: () => request<SystemInfo>('/api/system'),
  watchers: () => request<Watcher[]>('/api/watchers'),
  createWatcher: (payload: object) =>
    request<Watcher>('/api/watchers', { method: 'POST', body: JSON.stringify(payload) }),
  patchWatcher: (id: number, payload: object) =>
    request<Watcher>(`/api/watchers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWatcher: (id: number) => request<{ deleted: number }>(`/api/watchers/${id}`, { method: 'DELETE' }),
  // сервер ждёт проверку до 60 с — клиент чуть дольше
  runWatcher: (id: number) =>
    request<{ offers: number; alerts: number; bestPrice: number | null; anomalies?: number }>(`/api/watchers/${id}/run`, {
      method: 'POST',
      timeoutMs: 70_000
    }),
  history: (id: number, days = 7) => request<HistoryResp>(`/api/watchers/${id}/history?days=${days}`),
  deals: (limit = 100) => request<Deal[]>(`/api/deals?limit=${limit}`),
  alerts: (limit = 30) => request<AlertRow[]>(`/api/alerts?limit=${limit}`),
  settings: () => request<Record<string, string>>('/api/settings'),
  saveSettings: (payload: Record<string, unknown>) =>
    request<Record<string, string>>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  detect: (url: string) => request<{ ok: boolean; kind?: string; hint?: string }>(`/api/detect?url=${encodeURIComponent(url)}`)
}

export function fmtMoney(n: number | null | undefined, cur = 'KZT'): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sym = cur === 'KZT' ? '₸' : cur === 'USD' ? '$' : cur === 'RUB' ? '₽' : cur === 'EUR' ? '€' : cur
  return `${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')}\u2009${sym}`
}

// ---------- детектор аномалий ----------
export type ScanKind = 'krisha_zone' | 'kaspi_category'

export interface CatalogCity {
  id: string
  name: string
  kaspiCity: string
  center: [number, number]
  zoom: number
  districts: Array<{ alias: string; name: string }>
}

export interface CatalogCategory {
  code: string
  name: string
  group: string
  icon: string
}

export interface DetectorCatalog {
  cities: CatalogCity[]
  categories: CatalogCategory[]
}

export interface Scan {
  id: number
  kind: ScanKind
  title: string
  params: Record<string, unknown>
  interval_min: number
  active: boolean
  summary: string | null
  last_level: string | null
  last_error: string | null
  last_run_at: string | null
  next_run_at: string | null
  ago: string
  anomalies7d: number
}

export interface Anomaly {
  id: number
  watcher_id: number
  source: 'krisha' | 'kaspi'
  kind: 'drop' | 'market'
  external_id: string
  zone: string
  zone_label: string | null
  title: string | null
  url: string | null
  image: string | null
  price: number
  ref_value: number | null
  value: number | null
  pct: number
  score: number
  level: 'hot' | 'warm'
  suspicious: boolean
  reason: string | null
  meta: Record<string, unknown>
  created_at: string
  ago: string
}

export interface ZoneStat {
  listings: number
  medianUnit: number | null
  medianPrice: number | null
  anomalies7d: number
}

export const detector = {
  catalog: () => request<DetectorCatalog>('/api/detector/catalog'),
  scans: () => request<Scan[]>('/api/detector/scans'),
  createScan: (payload: { kind: ScanKind; params: object; interval_min?: number }) =>
    request<Scan>('/api/detector/scans', { method: 'POST', body: JSON.stringify(payload) }),
  updateScan: (id: number, payload: object) =>
    request<Scan>(`/api/detector/scans/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  anomalies: (source?: string, limit = 60) =>
    request<Anomaly[]>(`/api/detector/anomalies?limit=${limit}${source ? `&source=${source}` : ''}`),
  zones: (deal: string) => request<{ deal: string; zones: Record<string, ZoneStat> }>(`/api/detector/zones?deal=${deal}`)
}
