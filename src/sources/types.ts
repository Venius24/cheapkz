import type { HttpGuard } from '../http/client.js'

export interface Offer {
  externalId: string
  title: string
  url: string
  price: number | null
  oldPrice?: number | null
  currency?: string
  seller?: string | null
  inStock?: boolean
  publishedAt?: string | null
  meta?: Record<string, unknown>
}

/** Персистентный кэш с TTL (реализация — поверх таблицы kv). */
export interface AdapterCache {
  get(key: string): string | null
  set(key: string, value: string, ttlMs: number): void
}

export interface AdapterFetchArgs {
  guard: HttpGuard
  url: string
  params: Record<string, unknown>
  /** Токен Travelpayouts для адаптера билетов */
  tpToken: string | null
  /** Кэш вспомогательных данных (например, названий товаров), переживающий рестарт */
  cache?: AdapterCache
}

export interface SourceAdapter {
  kind: string
  label: string
  detect(url: URL): boolean
  fetch(args: AdapterFetchArgs): Promise<Offer[]>
}

export function absUrl(href: string | undefined | null, base = 'https://kaspi.kz'): string {
  if (!href) return base
  if (href.startsWith('http')) return href
  return new URL(href, base).toString()
}
