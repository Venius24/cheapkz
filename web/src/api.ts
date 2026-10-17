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

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY)

export class ApiError extends Error {}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken()}`,
      ...(opts.headers ?? {})
    }
  })
  if (res.status === 401) throw new ApiError('unauthorized')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(String((body as { error?: string }).error ?? `ошибка ${res.status}`))
  }
  return (await res.json()) as T
}

export const api = {
  stats: () => request<Stats>('/api/stats'),
  system: () => request<SystemInfo>('/api/system'),
  watchers: () => request<Watcher[]>('/api/watchers'),
  createWatcher: (payload: object) =>
    request<Watcher>('/api/watchers', { method: 'POST', body: JSON.stringify(payload) }),
  patchWatcher: (id: number, payload: object) =>
    request<Watcher>(`/api/watchers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWatcher: (id: number) => request<{ deleted: number }>(`/api/watchers/${id}`, { method: 'DELETE' }),
  runWatcher: (id: number) => request<{ offers: number; alerts: number; bestPrice: number | null }>(`/api/watchers/${id}/run`, { method: 'POST' }),
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
