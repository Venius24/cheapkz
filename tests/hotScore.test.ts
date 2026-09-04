import { describe, expect, it } from 'vitest'
import { hotScore, percentileRank } from '../src/core/hotScore.js'

describe('percentileRank', () => {
  it('считает долю значений ниже', () => {
    expect(percentileRank([10, 20, 30, 40], 25)).toBe(0.5)
    expect(percentileRank([10], 5)).toBe(0)
    expect(percentileRank([], 5)).toBe(1)
  })
})

describe('hotScore', () => {
  const flat = [100, 100, 100, 100, 100]

  it('глубокая скидка от старой цены + минимум истории = hot', () => {
    const r = hotScore({ price: 50, oldPrice: 100, history: [100, 99, 98, 97, 96, 95], isNew: false })
    expect(r.score).toBeGreaterThanOrEqual(65)
    expect(r.level).toBe('hot')
    expect(r.reason).toContain('старой цены')
  })

  it('цена у верха истории — cool', () => {
    const history = [80, 90, 100, 110, 120]
    const r = hotScore({ price: 110, oldPrice: null, history, isNew: false })
    expect(r.level).toBe('cool')
    expect(r.score).toBeLessThan(40)
  })

  it('мало данных -> нейтральный cool с пояснением', () => {
    const r = hotScore({ price: 100, oldPrice: null, history: [], isNew: false })
    expect(r.level).toBe('cool')
    expect(r.score).toBe(40)
    expect(r.reason).toContain('мало данных')
  })

  it('новая находка добавляет свежесть', () => {
    const a = hotScore({ price: 90, oldPrice: null, history: flat, isNew: false })
    const b = hotScore({ price: 90, oldPrice: null, history: flat, isNew: true })
    expect(b.score).toBeGreaterThan(a.score)
    expect(b.parts.fresh).toBe(1)
  })

  it('веса перераспределяются при отсутствии компонентов', () => {
    // только histPos доступен
    const r = hotScore({ price: 50, oldPrice: null, history: [100, 200, 300, 400, 500] })
    expect(r.parts.histPos).toBeCloseTo(1)
    expect(r.level).toBe('hot')
    expect(r.parts.vsOld).toBeUndefined()
  })

  it('score ограничен 0..100 и уровень по порогам', () => {
    for (const price of [0, 10, 60, 150]) {
      const r = hotScore({ price, oldPrice: 140, history: flat, isNew: true })
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      expect(['hot', 'warm', 'cool']).toContain(r.level)
    }
  })

  it('история короче 5 не используется для позиции', () => {
    const r = hotScore({ price: 10, oldPrice: null, history: [100, 200, 300], isNew: false })
    expect(r.parts.histPos).toBeUndefined()
    expect(r.level).toBe('cool')
  })
})
