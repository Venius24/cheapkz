import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseKrishaHtml, parseKrishaTitle, parsePeriod } from '../src/sources/krisha.js'
import {
  krishaCardsToItems,
  krishaZoneUrl,
  parseKaspiCategory,
  kaspiCategoryUrl,
  kaspiScanCategories,
  isScanKind
} from '../src/sources/scan.js'
import { detectKind } from '../src/sources/index.js'
import { CITIES, KASPI_CATEGORIES, findDistrict, isValidCategoryCode } from '../src/sources/catalog.js'
import { SourceError } from '../src/http/client.js'

const fx = (f: string): string => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')

describe('krisha: текущая разметка выдачи', () => {
  it('div.a-card[data-id], дубли «горячих предложений» схлопываются, <option data-id> не карточка', () => {
    const cards = parseKrishaHtml(fx('krisha_zone.html'))
    expect(cards.map((c) => c.externalId)).toEqual(['2000000001', '2000000002', '2000000003', '2000000004'])
    expect(cards[0]).toMatchObject({ price: 550000, period: 'month', area: 75, rooms: 3, urgent: false })
    expect(cards[0].address).toBe('Бостандыкский р-н, Гагарина 1')
    expect(cards[0].image).toMatch(/^https:\/\/krisha-photos/)
    expect(cards[1]).toMatchObject({ area: 45.5, rooms: 1, urgent: true })
    expect(cards[2].period).toBe('day')
  })
  it('период и заголовок', () => {
    expect(parsePeriod('300 000 ₸ за месяц')).toBe('month')
    expect(parsePeriod('250 000 ₸/мес')).toBe('month')
    expect(parsePeriod('25 000 ₸ за сутки')).toBe('day')
    expect(parsePeriod('40 500 000 ₸')).toBeNull()
    expect(parseKrishaTitle('2-комнатная квартира · 60 м² · 6/20 этаж')).toEqual({ rooms: 2, area: 60 })
    expect(parseKrishaTitle('Студия, 26 м²')).toEqual({ rooms: 1, area: 26 })
    expect(parseKrishaTitle('Комната')).toEqual({ rooms: null, area: null })
  })
})

describe('krisha_zone', () => {
  it('аренда: посуточные отбрасываются, считается ₸/м² и группа сравнения', () => {
    const items = krishaCardsToItems(fx('krisha_zone.html'), 'almaty-bostandykskij', 'arenda')
    expect(items.map((i) => i.externalId)).toEqual(['2000000001', '2000000002', '2000000004'])
    expect(items[0].meta).toMatchObject({
      zone: 'almaty-bostandykskij',
      zoneLabel: 'Бостандыкский р-н',
      market: 'arenda|almaty-bostandykskij',
      group: 'arenda|almaty-bostandykskij|3',
      area: 75,
      unit: 7333
    })
    // без площади — нет ₸/м², сравнение с рынком для него невозможно
    expect(items[2].meta.unit).toBeNull()
  })
  it('продажа: период не фильтруется', () => {
    expect(krishaCardsToItems(fx('krisha_zone.html'), 'almaty-bostandykskij', 'prodazha')).toHaveLength(4)
  })
  it('URL района с комнатами и страницей', () => {
    expect(krishaZoneUrl('arenda', 'almaty-medeuskij', [], 1)).toBe('https://krisha.kz/arenda/kvartiry/almaty-medeuskij/')
    expect(krishaZoneUrl('prodazha', 'almaty-medeuskij', [1, 2], 2)).toBe(
      'https://krisha.kz/prodazha/kvartiry/almaty-medeuskij/?das[live.rooms][0]=1&das[live.rooms][1]=2&page=2'
    )
  })
})

describe('kaspi_category', () => {
  it('парсит выдачу категории: цена со скидкой, картинка, пропуск без цены', () => {
    const items = parseKaspiCategory(JSON.parse(fx('kaspi_category.json')), 'Smartphones')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ externalId: '900000001', price: 179990, oldPrice: 249990 })
    expect(items[0].url).toBe('https://kaspi.kz/p/smartfon-example-x1-8-gb-256-gb-chernyi-900000001/?c=710000000')
    expect(items[0].meta).toMatchObject({ zone: 'Smartphones', zoneLabel: 'Смартфоны', group: null, rating: 4.8 })
    expect(items[0].meta.image).toContain('preview-medium')
    expect(items[1].price).toBe(59990)
  })
  it('неожиданный формат — PARSE', () => {
    expect(() => parseKaspiCategory({ nope: 1 }, 'X')).toThrow(SourceError)
  })
  it('URL категории кодирует фильтр и город', () => {
    const u = kaspiCategoryUrl('Smart watches', '750000000', 1)
    expect(u).toContain('q=%3Acategory%3ASmart%20watches')
    expect(u).toContain('page=1')
    expect(u).toContain('c=750000000')
  })
  it('широкий режим берёт весь справочник', () => {
    expect(kaspiScanCategories({ mode: 'broad' })).toHaveLength(KASPI_CATEGORIES.length)
    expect(kaspiScanCategories({ categories: ['TVs'] })).toEqual(['TVs'])
  })
})

describe('каталог', () => {
  it('у всех городов уникальные алиасы районов', () => {
    const all = CITIES.flatMap((c) => c.districts.map((d) => d.alias))
    expect(new Set(all).size).toBe(all.length)
    expect(findDistrict('almaty-medeuskij')?.city.id).toBe('almaty')
  })
  it('коды категорий безопасны для подстановки в фильтр', () => {
    expect(KASPI_CATEGORIES.every((c) => isValidCategoryCode(c.code))).toBe(true)
    expect(isValidCategoryCode('TVs:brand:x')).toBe(false)
  })
  it('сканы не перехватывают автодетект по URL', () => {
    expect(detectKind('https://krisha.kz/arenda/kvartiry/almaty/')).toBe('krisha')
    expect(isScanKind('krisha_zone')).toBe(true)
    expect(isScanKind('krisha')).toBe(false)
  })
})
