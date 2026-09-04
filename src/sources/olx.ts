import { numLoose } from '../util.js'
import { SourceError } from '../http/client.js'
import type { AdapterFetchArgs, Offer, SourceAdapter } from './types.js'

interface OlxListingJson {
  id?: string | number
  url?: string
  title?: string
  created_time?: string
  photos?: Array<{ link?: string }>
  params?: Array<{ key?: string; value?: { value?: unknown; currency?: string; label?: string } }>
}

/** Чистая функция — покрыта тестами. */
export function parseOlxListings(raw: unknown): Offer[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new SourceError('OLX: неожиданный формат ответа', 'PARSE')
  const out: Offer[] = []
  for (const d of data as OlxListingJson[]) {
    if (d.id == null || !d.url) continue
    const priceParam = d.params?.find((p) => p?.key === 'price')
    const price = numLoose(priceParam?.value?.value)
    out.push({
      externalId: String(d.id),
      title: String(d.title ?? '').trim() || 'Без названия',
      url: String(d.url),
      price,
      currency: priceParam?.value?.currency ?? 'KZT',
      publishedAt: d.created_time ?? null,
      meta: {
        photo: d.photos?.[0]?.link ?? null,
        label: priceParam?.value?.label ?? null
      }
    })
  }
  return out
}

/** Из поисковой ссылки OLX достаём текст запроса /q-.../ */
export function extractOlxQuery(url: string): string | null {
  try {
    const u = new URL(url)
    const qParam = u.searchParams.get('query')
    if (qParam) return qParam
    const seg = u.pathname.split('/').find((s) => s.startsWith('q-'))
    if (seg) return decodeURIComponent(seg.slice(2)).replace(/-/g, ' ').trim()
  } catch {
    /* ignore */
  }
  return null
}

export const olxAdapter: SourceAdapter = {
  kind: 'olx',
  label: 'Поиск OLX.kz',
  detect(u: URL): boolean {
    return /(^|\.)olx\.kz$/.test(u.hostname)
  },
  async fetch({ guard, url, params }: AdapterFetchArgs): Promise<Offer[]> {
    const query = String(params.query ?? extractOlxQuery(url) ?? '')
    if (!query) {
      throw new SourceError(
        'Укажите поисковый запрос OLX в параметрах (params.query) или ссылку вида olx.kz/…/q-iphone/',
        'NOT_FOUND'
      )
    }
    const qs = new URLSearchParams({
      query,
      currency: 'KZT',
      size: '40',
      ...((params.extra as Record<string, string>) ?? {})
    })
    if (params.category_id != null) qs.set('category_id', String(params.category_id))
    if (params.region_id != null) qs.set('region_id', String(params.region_id))
    const api = `https://www.olx.kz/api/v1/offers/?${qs.toString()}`
    const json = await guard.getJson(api, {
      headers: { accept: 'application/json', referer: url || 'https://www.olx.kz/' }
    })
    return parseOlxListings(json).slice(0, Number(params.limit ?? 40))
  }
}
