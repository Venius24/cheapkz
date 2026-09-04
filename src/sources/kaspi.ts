import { numLoose } from '../util.js'
import { SourceError } from '../http/client.js'
import { absUrl, type AdapterFetchArgs, type Offer, type SourceAdapter } from './types.js'

export function extractKaspiSku(url: string): string | null {
  const m = url.match(/\/p\/[^/]+\/([a-zA-Z0-9]+)\/?/)
  return m ? m[1] : null
}

export function kaspiProductSlug(url: string): string | null {
  const m = url.match(/\/p\/([^/]+)\//)
  return m ? m[1] : null
}

export function slugTitle(slug: string): string {
  const cleaned = decodeURIComponent(slug)
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

interface KaspiOfferJson {
  id?: string | number
  attributes?: Record<string, unknown>
}

/** Чистая функция парсинга ответа offers API — покрыта тестами. */
export function parseKaspiOffers(raw: unknown): Offer[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new SourceError('Kaspi: неожиданный формат ответа', 'PARSE')
  const out: Offer[] = []
  for (const d of data as KaspiOfferJson[]) {
    const a = d.attributes ?? {}
    const price = numLoose(a.price)
    if (price == null) continue
    out.push({
      externalId: String(d.id ?? `m${out.length}`),
      // в offers API attributes.name — это название магазина-продавца
      title: typeof a.name === 'string' ? a.name : '',
      url: absUrl(typeof a.url === 'string' ? a.url : ''),
      price,
      oldPrice: numLoose(a.oldPrice),
      currency: 'KZT',
      seller: typeof a.name === 'string' ? a.name : null,
      inStock: true,
      meta: {}
    })
  }
  out.sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity))
  return out
}

export function extractOgTitle(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  return m ? m[1].trim() : null
}

const TITLE_TTL_MS = 12 * 3600_000

/**
 * Название товара берём из og:title страницы и кэшируем в kv на 12 часов:
 * лишний HTTP-запрос на каждой проверке — прямой путь к бану.
 */
async function resolveTitle(
  args: Pick<AdapterFetchArgs, 'guard' | 'cache'>,
  productUrl: string,
  fallbackSlug: string | null
): Promise<string> {
  const key = `og:${productUrl.split('?')[0]}`
  const hit = args.cache?.get(key)
  if (hit) return hit
  let title = fallbackSlug ? slugTitle(fallbackSlug) : productUrl
  try {
    const r = await args.guard.getText(productUrl, { timeoutMs: 15_000 })
    const og = extractOgTitle(r.body)
    if (og) title = og
  } catch {
    /* заголовок не критичен — остаётся slug */
  }
  args.cache?.set(key, title, TITLE_TTL_MS)
  return title
}

export async function fetchKaspiProduct(args: AdapterFetchArgs): Promise<{ offers: Offer[]; title: string }> {
  const { guard, url, params } = args
  const sku = extractKaspiSku(url)
  if (!sku) {
    throw new SourceError(
      'Не удалось извлечь SKU. Нужна ссылка на товар вида https://kaspi.kz/p/nazvanie/12345678/',
      'NOT_FOUND'
    )
  }
  const city = String(params.city ?? '710000000') // 710000000 — Алматы, 750000000 — Астана
  const api = `https://kaspi.kz/shop/api/v2/products/${sku}/offers?c=${encodeURIComponent(city)}&limit=10&page=0&sort=ASC`
  const json = await guard.getJson(api, { headers: { accept: 'application/json', referer: url } })
  const offers = parseKaspiOffers(json)
  const title = await resolveTitle(args, url, kaspiProductSlug(url))
  // название товара одно на все предложения, а attributes.name — это продавец
  return { offers: offers.map((o) => ({ ...o, title, seller: o.seller ?? o.title })), title }
}

export const kaspiAdapter: SourceAdapter = {
  kind: 'kaspi',
  label: 'Товар Kaspi',
  detect(u: URL): boolean {
    return /(^|\.)kaspi\.kz$/.test(u.hostname) && u.pathname.startsWith('/p/')
  },
  async fetch(args) {
    const { offers } = await fetchKaspiProduct(args)
    return offers
  }
}
