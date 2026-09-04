import * as cheerio from 'cheerio'
import { numLoose } from '../util.js'
import type { AdapterFetchArgs, Offer, SourceAdapter } from './types.js'

export interface ParsedKrishaCard {
  externalId: string
  title: string
  url: string
  price: number | null
  period: string | null
}

function firstText($: ReturnType<typeof cheerio.load>, el: never, selectors: string[]): string | null {
  for (const s of selectors) {
    const t = $(el).find(s).first().text().trim()
    if (t) return t
  }
  return null
}

/** Чистая функция парсинга HTML выдачи Krisha — покрыта тестами. */
export function parseKrishaHtml(html: string): ParsedKrishaCard[] {
  const $ = cheerio.load(html)
  const cards = $('article[data-id], .a-card__item').toArray()
  const out: ParsedKrishaCard[] = []
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
    if (!id) continue
    const title =
      firstText($, el, ['[data-testid="card.title"]', '.a-card__title', 'h3', 'h2']) ?? 'Объявление'
    const priceText = firstText($, el, ['.a-card__price', '[data-testid="card.price"]']) ?? ''
    const price = numLoose(priceText)
    const absHref = href.startsWith('http') ? href : href ? `https://krisha.kz${href}` : ''
    out.push({
      externalId: id,
      title,
      url: absHref,
      price,
      period: priceText.includes('/мес') ? 'month' : null
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
      meta: { period: c.period }
    }))
  }
}
