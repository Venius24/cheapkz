import { numLoose } from '../util.js'
import { SourceError } from '../http/client.js'
import { parseKrishaHtml } from './krisha.js'
import { findDistrict, findKaspiCategory, KASPI_CATEGORIES } from './catalog.js'
import { absUrl, type AdapterFetchArgs, type Offer, type SourceAdapter } from './types.js'

/**
 * Сканеры для детектора аномалий. В отличие от обычных адаптеров они обходят
 * целую зону (районы Krisha или категории Kaspi) и возвращают много независимых
 * позиций; meta каждой позиции описывает, с кем её сравнивать.
 */
export interface ScanMeta {
  /** Алиас района или код категории */
  zone: string
  zoneLabel: string
  /** Группа сравнения «с рынком» (сделка + район + комнатность); null — сравнение только с собственной историей */
  group: string | null
  /** Рынок без комнатности (сделка + район) — запасная группа */
  market?: string | null
  /** Площадь, м² — сравниваем только с квартирами похожего размера */
  area?: number | null
  /** Цена за единицу для сравнения с группой (₸/м²) */
  unit: number | null
  image: string | null
  [k: string]: unknown
}

export type ScanItem = Offer & { price: number; meta: ScanMeta }

export const SCAN_KINDS = new Set(['krisha_zone', 'kaspi_category'])

export function isScanKind(kind: string): boolean {
  return SCAN_KINDS.has(kind)
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

function pagesOf(params: Record<string, unknown>, dflt: number): number {
  const n = Math.round(Number(params.pages ?? dflt))
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : dflt
}

/**
 * Обход списка страниц: ошибка одной страницы не обнуляет весь скан,
 * но если не удалось вообще ничего — пробрасываем первую ошибку
 * (чтобы сработал общий бэкофф при блокировке).
 */
async function crawl<T>(tasks: Array<() => Promise<T[] | null>>): Promise<T[]> {
  const out: T[] = []
  let ok = 0
  let firstErr: unknown = null
  for (const t of tasks) {
    try {
      const r = await t()
      ok++
      if (r) out.push(...r)
    } catch (e) {
      firstErr ??= e
      if (e instanceof SourceError && e.code === 'BLOCKED') break
    }
  }
  if (ok === 0 && firstErr) throw firstErr
  return out
}

// ---------- Krisha: районы ----------

export function krishaZoneUrl(deal: string, alias: string, rooms: number[], page: number): string {
  const qs: string[] = rooms.map((r, i) => `das[live.rooms][${i}]=${r}`)
  if (page > 1) qs.push(`page=${page}`)
  return `https://krisha.kz/${deal}/kvartiry/${alias}/${qs.length ? `?${qs.join('&')}` : ''}`
}

/** Чистое преобразование карточек выдачи района в позиции скана. */
export function krishaCardsToItems(html: string, alias: string, deal: string): ScanItem[] {
  const zoneLabel = findDistrict(alias)?.district.name ?? alias
  const out: ScanItem[] = []
  for (const c of parseKrishaHtml(html)) {
    if (c.price == null || c.price <= 0) continue
    // посуточная цена в 20–30 раз ниже помесячной — сравнивать их нельзя
    if (deal === 'arenda' && c.period !== 'month') continue
    out.push({
      externalId: c.externalId,
      title: c.title,
      url: c.url,
      price: c.price,
      currency: 'KZT',
      meta: {
        zone: alias,
        zoneLabel,
        // аренда и продажа — разные рынки: ₸/м² отличаются на два порядка
        market: `${deal}|${alias}`,
        group: `${deal}|${alias}|${c.rooms ?? '?'}`,
        unit: c.area ? Math.round(c.price / c.area) : null,
        image: c.image,
        area: c.area,
        rooms: c.rooms,
        address: c.address,
        urgent: c.urgent,
        deal
      }
    })
  }
  return out
}

export const krishaZoneAdapter: SourceAdapter = {
  kind: 'krisha_zone',
  label: 'Детектор: районы Krisha',
  detect: () => false,
  async fetch({ guard, params }: AdapterFetchArgs): Promise<Offer[]> {
    const deal = params.deal === 'prodazha' ? 'prodazha' : 'arenda'
    const districts = strList(params.districts).filter((a) => findDistrict(a))
    if (!districts.length) throw new SourceError('не выбрано ни одного района', 'CONFIG')
    const rooms = (Array.isArray(params.rooms) ? params.rooms : [])
      .map(Number)
      .filter((r) => Number.isInteger(r) && r >= 1 && r <= 4)
    const pages = pagesOf(params, 2)
    const tasks: Array<() => Promise<ScanItem[] | null>> = []
    for (const alias of districts) {
      let exhausted = false
      for (let p = 1; p <= pages; p++) {
        tasks.push(async () => {
          if (exhausted) return null
          const res = await guard.getText(krishaZoneUrl(deal, alias, rooms, p))
          const items = krishaCardsToItems(res.body, alias, deal)
          if (!items.length) exhausted = true
          return items
        })
      }
    }
    return dedupe(await crawl(tasks))
  }
}

// ---------- Kaspi: категории ----------

interface KaspiCardJson {
  id?: string | number
  title?: string
  brand?: string
  shopLink?: string
  unitPrice?: unknown
  unitSalePrice?: unknown
  unitPriceBeforeDiscount?: unknown
  rating?: unknown
  reviewsQuantity?: unknown
  previewImages?: Array<{ medium?: string; small?: string }>
}

/** Чистая функция парсинга выдачи категории Kaspi — покрыта тестами. */
export function parseKaspiCategory(raw: unknown, code: string): ScanItem[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new SourceError('Kaspi: неожиданный формат выдачи категории', 'PARSE')
  const zoneLabel = findKaspiCategory(code)?.name ?? code
  const out: ScanItem[] = []
  for (const d of data as KaspiCardJson[]) {
    const price = numLoose(d.unitSalePrice) ?? numLoose(d.unitPrice)
    if (d.id == null || price == null || price <= 0) continue
    const img = d.previewImages?.[0]
    out.push({
      externalId: String(d.id),
      title: String(d.title ?? '').trim() || `Товар ${d.id}`,
      url: absUrl(d.shopLink ?? `/p/-/${d.id}/`),
      price,
      oldPrice: numLoose(d.unitPriceBeforeDiscount),
      currency: 'KZT',
      inStock: true,
      meta: {
        zone: code,
        zoneLabel,
        group: null,
        unit: null,
        image: img?.medium ?? img?.small ?? null,
        brand: d.brand ?? null,
        rating: numLoose(d.rating),
        reviews: numLoose(d.reviewsQuantity)
      }
    })
  }
  return out
}

export function kaspiCategoryUrl(code: string, city: string, page: number): string {
  const q = encodeURIComponent(`:category:${code}`)
  return `https://kaspi.kz/yml/product-view/pl/results?page=${page}&q=${q}&text&sort=relevance&qs&ui=d&i=-1&c=${encodeURIComponent(city)}`
}

/** Широкий режим — все категории справочника, но неглубоко. */
export function kaspiScanCategories(params: Record<string, unknown>): string[] {
  if (params.mode === 'broad') return KASPI_CATEGORIES.map((c) => c.code)
  return strList(params.categories)
}

export const kaspiCategoryAdapter: SourceAdapter = {
  kind: 'kaspi_category',
  label: 'Детектор: категории Kaspi',
  detect: () => false,
  async fetch({ guard, params }: AdapterFetchArgs): Promise<Offer[]> {
    const city = /^\d{9}$/.test(String(params.city ?? '')) ? String(params.city) : '710000000'
    const codes = kaspiScanCategories(params)
    if (!codes.length) throw new SourceError('не выбрано ни одной категории', 'CONFIG')
    const pages = pagesOf(params, params.mode === 'broad' ? 1 : 2)
    const tasks: Array<() => Promise<ScanItem[] | null>> = []
    for (const code of codes) {
      for (let p = 0; p < pages; p++) {
        tasks.push(async () => {
          const json = await guard.getJson(kaspiCategoryUrl(code, city, p), {
            headers: { accept: 'application/json', referer: 'https://kaspi.kz/shop/' }
          })
          return parseKaspiCategory(json, code)
        })
      }
    }
    return dedupe(await crawl(tasks))
  }
}

function dedupe(items: ScanItem[]): ScanItem[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i.externalId) ? false : (seen.add(i.externalId), true)))
}
