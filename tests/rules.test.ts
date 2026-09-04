import { describe, expect, it } from 'vitest'
import { evaluateRules, filtersOf, passesFilters } from '../src/core/rules.js'
import { hotScore } from '../src/core/hotScore.js'
import type { Offer } from '../src/sources/types.js'

function offer(p: Partial<Offer> = {}): Offer {
  return {
    externalId: 'x1',
    title: 'iPhone 13',
    url: 'https://example.com/x1',
    price: 100,
    ...p
  }
}

const score = hotScore({ price: 100, oldPrice: null, history: [], isNew: false })

describe('passesFilters', () => {
  it('require по нескольким словам', () => {
    const f = { require: ['iphone 13'] }
    expect(passesFilters(offer({ title: 'iPhone 13 128gb' }), f)).toBe(true)
    expect(passesFilters(offer({ title: 'iPhone 12' }), f)).toBe(false)
  })
  it('exclude блокирует', () => {
    expect(passesFilters(offer({ title: 'Чехол для iphone' }), { exclude: ['чехол'] })).toBe(false)
  })
  it('диапазон цены', () => {
    const f = { min_price: 50, max_price: 200 }
    expect(passesFilters(offer({ price: 150 }), f)).toBe(true)
    expect(passesFilters(offer({ price: 10 }), f)).toBe(false)
    expect(passesFilters(offer({ price: null }), f)).toBe(false)
  })
})

describe('evaluateRules', () => {
  it('target_hit срабатывает и поднимает cool до warm', () => {
    const r = evaluateRules({
      watcher: { id: 1, kind: 'kaspi', target_price: 120, drop_pct: null, params: {} },
      best: offer({ price: 100 }),
      prevPrice: null,
      history: [],
      score,
      newMatching: []
    })
    expect(r.map((x) => x.rule)).toEqual(['target_hit'])
    expect(r[0].level).toBe('warm')
  })

  it('drop_pct по границе', () => {
    const base = { watcher: { id: 1, kind: 'olx', target_price: null, params: {} }, history: [], score, newMatching: [] }
    const r = evaluateRules({
      ...base,
      watcher: { ...base.watcher, drop_pct: 20 },
      best: offer({ price: 80 }),
      prevPrice: 100
    })
    expect(r.some((x) => x.rule === 'drop_pct')).toBe(true)

    const r2 = evaluateRules({ ...base, watcher: { ...base.watcher, drop_pct: 21 }, best: offer({ price: 80 }), prevPrice: 100 })
    expect(r2.some((x) => x.rule === 'drop_pct')).toBe(false)
  })

  it('low_percentile требует ≥10 точек истории', () => {
    const base = {
      watcher: { id: 1, kind: 'olx', target_price: null, drop_pct: null, params: {} },
      newMatching: [] as Offer[],
      score,
      prevPrice: 200 as number | null
    }
    const shortHist = [200, 210, 220]
    const longHist = Array.from({ length: 12 }, (_, i) => 300 - i * 10) // все выше 100
    const rShort = evaluateRules({ ...base, best: offer({ price: 100 }), history: shortHist })
    const rLong = evaluateRules({ ...base, best: offer({ price: 100 }), history: longHist })
    expect(rShort.some((x) => x.rule === 'low_percentile')).toBe(false)
    expect(rLong.some((x) => x.rule === 'low_percentile')).toBe(true)
  })

  it('new_match уважает фильтры и лимит 3, отключён для kaspi по умолчанию', () => {
    const news = [offer({ externalId: 'a', title: 'Дешёвая квартира Астана' }), offer({ externalId: 'b', title: 'Квартира Алматы' }), offer({ externalId: 'c', title: 'Хостел' }), offer({ externalId: 'd', title: 'Ещё вариант' })]
    const base = { prevPrice: null, history: [], score }
    const r = evaluateRules({
      ...base,
      watcher: { id: 1, kind: 'krisha', target_price: null, drop_pct: null, params: { filters: { require: ['квартира'] } } },
      best: offer(),
      newMatching: news.filter((o) => passesFilters(o, filtersOf({ filters: { require: ['квартира'] } })))
    })
    const nm = r.filter((x) => x.rule === 'new_match')
    expect(nm.length).toBe(2) // хостел отфильтрован, максимум 3

    const rKaspi = evaluateRules({
      ...base,
      watcher: { id: 2, kind: 'kaspi', target_price: null, drop_pct: null, params: {} },
      best: offer(),
      newMatching: [offer()]
    })
    expect(rKaspi.some((x) => x.rule === 'new_match')).toBe(false)
  })
})
