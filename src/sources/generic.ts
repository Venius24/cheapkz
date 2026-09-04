import * as cheerio from 'cheerio'
import { hashStr, numLoose } from '../util.js'
import { SourceError } from '../http/client.js'
import type { AdapterFetchArgs, Offer, SourceAdapter } from './types.js'

export interface GenericSpec {
  selector: string
  attr?: string | null
  matchAll?: boolean
  transform?: 'number' | 'text'
}

export function parseGenericHtml(html: string, spec: GenericSpec): Array<{ value: string; isNumber: boolean }> {
  if (!spec?.selector) throw new SourceError('Для универсального адаптера нужен params.selector (CSS)', 'CONFIG')
  const $ = cheerio.load(html)
  const els = $(spec.selector).toArray()
  if (!els.length) throw new SourceError(`Селектор «${spec.selector}» ничего не нашёл на странице`, 'PARSE')
  const out: Array<{ value: string; isNumber: boolean }> = []
  const limit = spec.matchAll ? els.length : 1
  for (let i = 0; i < limit; i++) {
    const el = els[i]
    const raw =
      spec.attr != null
        ? $(el).attr(spec.attr) ?? ''
        : $(el).text().trim()
    if (!raw && spec.attr != null) continue
    out.push({ value: String(raw).trim(), isNumber: spec.transform === 'number' })
  }
  return out
}

export function pageTitle(html: string): string {
  const $ = cheerio.load(html)
  return (
    $('meta[property="og:title"]').attr('content') ??
    $('title').first().text().trim() ??
    'Страница'
  )
}

export const genericAdapter: SourceAdapter = {
  kind: 'generic',
  label: 'Любая страница (CSS-селектор)',
  detect(): boolean {
    return false // fallback
  },
  async fetch({ guard, url, params }: AdapterFetchArgs): Promise<Offer[]> {
    const spec: GenericSpec = {
      selector: String(params.selector ?? ''),
      attr: (params.attr as string) ?? null,
      matchAll: Boolean(params.matchAll),
      transform: (params.transform as 'number' | 'text') ?? 'number'
    }
    const res = await guard.getText(url)
    const found = parseGenericHtml(res.body, spec)
    const title = pageTitle(res.body)
    return found.map((f, i) => ({
      externalId: `g:${hashStr(`${url}|${spec.selector}|${i}`)}`,
      title,
      url,
      price: f.isNumber ? numLoose(f.value) : null,
      currency: 'KZT',
      meta: { raw: f.value.slice(0, 200), index: i }
    }))
  }
}
