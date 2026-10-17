import * as cheerio from 'cheerio'
import { numLoose } from '../util.js'
import type { AdapterFetchArgs, Offer, SourceAdapter } from './types.js'

export interface ParsedKrishaCard {
  externalId: string
  title: string
  url: string
  price: number | null
  /** month — помесячная аренда, day — посуточная, hour — почасовая, null — продажа/не указано */
  period: 'month' | 'day' | 'hour' | null
  /** Площадь в м², если есть в заголовке */
  area: number | null
  rooms: number | null
  /** Подзаголовок карточки: «Бостандыкский р-н, Гагарина 233» */
  address: string | null
  urgent: boolean
  image: string | null
}

function firstText($: ReturnType<typeof cheerio.load>, el: never, selectors: string[]): string | null {
  for (const s of selectors) {
    const t = $(el).find(s).first().text().replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return null
}

export function parsePeriod(priceText: string): ParsedKrishaCard['period'] {
  const t = priceText.toLowerCase()
  if (/\/\s*мес|за месяц|в месяц/.test(t)) return 'month'
  if (/сутк|посуточ/.test(t)) return 'day'
  if (/за час|\/\s*час/.test(t)) return 'hour'
  return null
}

/** «2-комнатная квартира · 60 м² · 6/20 этаж» → { rooms: 2, area: 60 } */
export function parseKrishaTitle(title: string): { rooms: number | null; area: number | null } {
  const area = title.match(/(\d+(?:[.,]\d+)?)\s*м²/)
  const rooms = title.match(/(\d+)\s*-\s*(?:комн|к\b|к\s)/i)
  return {
    area: area ? Number(area[1].replace(',', '.')) : null,
    rooms: rooms ? Number(rooms[1]) : /студи/i.test(title) ? 1 : null
  }
}

/** Чистая функция парсинга HTML выдачи Krisha — покрыта тестами. */
export function parseKrishaHtml(html: string): ParsedKrishaCard[] {
  const $ = cheerio.load(html)
  // текущая разметка — div.a-card[data-id]; article/.a-card__item — прежняя
  const cards = $('.a-card[data-id], article[data-id], .a-card__item').toArray()
  const out: ParsedKrishaCard[] = []
  const seen = new Set<string>()
  for (const node of cards) {
    const el = node as never
    let id = $(el).attr('data-id') ?? ''
    const href =
      $(el).find('a[href*="/a/show/"]').first().attr('href') ??
      $(el).find('a.a-card__title').first().attr('href') ??
      ''
    if (!id) {
      const m = href.match(/\/show\/(\d+)/)
      if (m) id = m[1]
    }
    // «горячие предложения» дублируют карточки основной выдачи
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title =
      firstText($, el, ['[data-testid="card.title"]', '.a-card__title', 'h3', 'h2']) ?? 'Объявление'
    const priceText = firstText($, el, ['.a-card__price', '[data-testid="card.price"]']) ?? ''
    const price = numLoose(priceText)
    const absHref = href.startsWith('http') ? href : href ? `https://krisha.kz${href}` : ''
    const { rooms, area } = parseKrishaTitle(title)
    const img = $(el).find('img').first()
    const image = img.attr('src') ?? img.attr('data-src') ?? null
    out.push({
      externalId: id,
      title,
      url: absHref,
      price,
      period: parsePeriod(priceText),
      area,
      rooms,
      address: firstText($, el, ['.a-card__subtitle']),
      urgent: $(el).hasClass('is-urgent'),
      image: image && image.startsWith('http') ? image : null
    })
  }
  return out
}

export const krishaAdapter: SourceAdapter = {
  kind: 'krisha',
  label: 'Недвижимость Krisha.kz',
  detect(u: URL): boolean {
    return /(^|\.)krisha\.kz$/.test(u.hostname)
  },
  async fetch({ guard, url, params }: AdapterFetchArgs): Promise<Offer[]> {
    const pageUrl = String(params.url ?? url) || 'https://krisha.kz/arenda/'
    const res = await guard.getText(pageUrl)
    const cards = parseKrishaHtml(res.body)
    return cards.map<Offer>((c) => ({
      externalId: c.externalId,
      title: c.title,
      url: c.url,
      price: c.price,
      currency: 'KZT',
      meta: { period: c.period, area: c.area, rooms: c.rooms, address: c.address }
    }))
  }
}
