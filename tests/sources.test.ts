import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  extractKaspiSku,
  kaspiProductSlug,
  parseKaspiOffers,
  fetchKaspiProduct,
  slugTitle,
  extractOgTitle,
  kaspiAdapter
} from '../src/sources/kaspi.js'
import { parseOlxListings, extractOlxQuery, olxAdapter } from '../src/sources/olx.js'
import { parseKrishaHtml, krishaAdapter } from '../src/sources/krisha.js'
import { parseFlights, flightUrl, assertTpToken } from '../src/sources/flights.js'
import { parseGenericHtml } from '../src/sources/generic.js'
import { detectKind } from '../src/sources/index.js'
import { SourceError } from '../src/http/client.js'

const fx = (f: string): string => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')

describe('kaspi', () => {
  it('извлекает SKU из разных форм ссылок', () => {
    expect(extractKaspiSku('https://kaspi.kz/p/apple-iphone-15-128gb/105621344/')).toBe('105621344')
    expect(extractKaspiSku('https://kaspi.kz/p/x/abc123/?c=750000000')).toBe('abc123')
    expect(extractKaspiSku('https://kaspi.kz/shop/c/catalog/')).toBeNull()
  })
  it('slug -> человекочитаемый заголовок', () => {
    expect(slugTitle('apple-iphone-15-128gb')).toBe('Apple iphone 15 128gb')
  })
  it('парсит offers API: сортировка по цене, пропуск без цены', () => {
    const offers = parseKaspiOffers(JSON.parse(fx('kaspi_offers.json')))
    expect(offers.map((o) => o.price)).toEqual([184990, 189990, 199990])
    expect(offers[0].seller).toBe('Sulpak')
    expect(offers.find((o) => o.seller === 'BadMerchant')).toBeUndefined()
    expect(offers[1].oldPrice).toBe(209990)
  })
  it('название товара подставляется во все предложения, продавец сохраняется', async () => {
    const calls: string[] = []
    const store = new Map<string, string>()
    const guard = {
      getJson: async () => JSON.parse(fx('kaspi_offers.json')),
      getText: async (u: string) => {
        calls.push(u)
        return { status: 200, body: '<meta property="og:title" content="Apple iPhone 15 128GB">', ms: 1, viaProxy: null, url: u }
      }
    } as never

    const cache = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v)
    }
    const args = {
      guard,
      url: 'https://kaspi.kz/p/apple-iphone-15-128gb/105621344/',
      params: {},
      tpToken: null,
      cache
    }

    const first = await fetchKaspiProduct(args)
    expect(first.title).toBe('Apple iPhone 15 128GB')
    expect(first.offers.every((o) => o.title === 'Apple iPhone 15 128GB')).toBe(true)
    expect(first.offers[0].seller).toBe('Sulpak')

    // повторный вызов берёт название из кэша и не ходит за страницей второй раз
    const second = await fetchKaspiProduct(args)
    expect(second.title).toBe('Apple iPhone 15 128GB')
    expect(calls.length).toBe(1)
  })

  it('битый JSON -> SourceError PARSE', () => {
    expect(() => parseKaspiOffers({ nope: 1 })).toThrow(SourceError)
  })
  it('og:title извлекается', () => {
    expect(extractOgTitle('<meta property="og:title" content="Товар X">')).toBe('Товар X')
  })
  it('detect', () => {
    expect(kaspiAdapter.detect(new URL('https://kaspi.kz/p/a/1/'))).toBe(true)
    expect(kaspiAdapter.detect(new URL('https://kaspi.kz/shop/'))).toBe(false)
    expect(kaspiProductSlug('https://kaspi.kz/p/super-tovar/1/')).toBe('super-tovar')
  })
})

describe('olx', () => {
  it('парсит выдачу, цена из params', () => {
    const offers = parseOlxListings(JSON.parse(fx('olx_offers.json')))
    expect(offers.length).toBe(2)
    expect(offers[0].price).toBe(185000)
    expect(offers[0].currency).toBe('KZT')
    expect(offers[0].meta.photo).toContain('apollo')
  })
  it('объявление без цены не падает', () => {
    const offers = parseOlxListings(JSON.parse(fx('olx_offers.json')))
    expect(offers[1].price).toBeNull()
  })
  it('query из ссылки /q-…/', () => {
    expect(extractOlxQuery('https://www.olx.kz/elektronika/q-iphone-13/')).toBe('iphone 13')
    expect(extractOlxQuery('https://www.olx.kz/list/?query=ps5')).toBe('ps5')
  })
  it('detect', () => {
    expect(olxAdapter.detect(new URL('https://www.olx.kz/q-x/'))).toBe(true)
  })
})

describe('krisha', () => {
  it('парсит карточки объявлений', () => {
    const cards = parseKrishaHtml(fx('krisha.html'))
    expect(cards.length).toBe(3)
    expect(cards[0]).toMatchObject({ externalId: '1098765', price: 250000, period: 'month' })
    // id берётся из href, если нет data-id
    expect(cards[2].externalId).toBe('1100455')
    expect(cards.every((c) => c.url.startsWith('https://krisha.kz/a/show/'))).toBe(true)
  })
  it('detect', () => {
    expect(krishaAdapter.detect(new URL('https://krisha.kz/arenda/almaty/'))).toBe(true)
  })
})

describe('flights', () => {
  it('парсит билеты и строит ссылку aviasales.kz', () => {
    const offers = parseFlights(JSON.parse(fx('flights.json')))
    expect(offers.length).toBe(2)
    expect(offers[0].price).toBe(34900)
    expect(offers[0].currency).toBe('KZT')
    expect(offers[0].url).toContain('aviasales.kz/search/')
    expect(offers[0].title).toContain('ALA→NQZ')
  })
  it('без токена — понятная ошибка CONFIG', () => {
    expect(() => assertTpToken(null)).toThrow(/TRAVELPAYOUTS_TOKEN/)
    expect(() => assertTpToken('t')).not.toThrow()
  })
})

describe('generic', () => {
  it('первое совпадение по селектору', () => {
    const r = parseGenericHtml(fx('generic.html'), { selector: '.price', transform: 'number' })
    expect(r.length).toBe(1)
    expect(r[0].value).toBe('12 990 тг')
  })
  it('matchAll отдаёт все совпадения', () => {
    const r = parseGenericHtml(fx('generic.html'), { selector: '.price', matchAll: true })
    expect(r.length).toBe(2)
  })
  it('пустой селектор -> CONFIG', () => {
    expect(() => parseGenericHtml('<div/>', { selector: '' })).toThrow(SourceError)
  })
})

describe('detectKind', () => {
  it('определяет источники и fallback', () => {
    expect(detectKind('https://kaspi.kz/p/x/1/')).toBe('kaspi')
    expect(detectKind('https://www.olx.kz/d/obyavlenie/x/')).toBe('olx')
    expect(detectKind('https://krisha.kz/arenda/')).toBe('krisha')
    expect(detectKind('https://example.com/page')).toBe('generic')
    expect(detectKind('not a url')).toBe('generic')
  })
})
