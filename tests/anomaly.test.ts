import { describe, expect, it } from 'vitest'
import {
  anomalyScore,
  detectAnomaly,
  detectBelowMarket,
  detectDrop,
  mad,
  median,
  ownReference,
  settingsOf,
  DEFAULT_SETTINGS
} from '../src/core/anomaly.js'

describe('статистика', () => {
  it('median / mad', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(Number.isNaN(median([]))).toBe(true)
    expect(mad([10, 10, 10])).toBe(0)
    expect(mad([1, 2, 3, 4, 100])).toBeCloseTo(1.4826, 3)
  })
  it('норма позиции: прошлый замер при коротком ряде, медиана при длинном', () => {
    expect(ownReference([])).toBeNull()
    expect(ownReference([100, 90])).toEqual({ ref: 90, basis: 2 })
    // один выброс вверх не задирает норму
    expect(ownReference([100, 100, 500, 100])).toEqual({ ref: 100, basis: 4 })
  })
  it('score: порог → 40, двойной порог → 65 (hot), сверху 100', () => {
    expect(anomalyScore(7, 7)).toBe(40)
    expect(anomalyScore(14, 7)).toBe(65)
    expect(anomalyScore(90, 7)).toBe(100)
  })
})

describe('drop: падение относительно своей нормы', () => {
  it('−10% от медианы при пороге 7% → warm', () => {
    const a = detectDrop({ price: 90, history: [100, 100, 100] })
    expect(a).toMatchObject({ kind: 'drop', ref: 100, pct: 10, level: 'warm' })
    expect(a?.reason).toContain('медиана 3 замеров')
  })
  it('−20% → hot', () => {
    expect(detectDrop({ price: 80, history: [100, 100, 100] })?.level).toBe('hot')
  })
  it('мелкое колебание ниже порога — нет', () => {
    expect(detectDrop({ price: 96, history: [100, 100, 100] })).toBeNull()
  })
  it('цена уже держится низко (не переход вниз) — повторно не кричим', () => {
    expect(detectDrop({ price: 80, history: [100, 100, 80] })).toBeNull()
  })
  it('откат после скачка вверх — не аномалия, хотя ниже прошлого замера', () => {
    // норма 100, прошлый замер — выброс 150; 99 — обычная цена
    expect(detectDrop({ price: 99, history: [100, 100, 100, 150] })).toBeNull()
  })
  it('без истории — нечего сравнивать', () => {
    expect(detectDrop({ price: 1, history: [] })).toBeNull()
  })
})

describe('market: ниже медианы района', () => {
  const peers = [10_000, 9_800, 10_200, 10_100, 9_900, 10_050, 9_950]
  it('−30% ₸/м² при плотном рынке → аномалия', () => {
    const a = detectBelowMarket({ price: 420_000, history: [], unit: 7_000, peers })
    expect(a).toMatchObject({ kind: 'market', ref: 10_000, value: 7_000, pct: 30, basis: 7, suspicious: false })
  })
  it('мало сопоставимых объявлений — молчим', () => {
    expect(detectBelowMarket({ price: 1, history: [], unit: 5_000, peers: peers.slice(0, 3) })).toBeNull()
  })
  it('при огромном разбросе −20% ещё не аномалия', () => {
    const wide = [4_000, 6_000, 8_000, 10_000, 12_000, 14_000, 16_000]
    expect(detectBelowMarket({ price: 1, history: [], unit: 8_000, peers: wide })).toBeNull()
  })
  it('слишком дёшево (≥ 55%) помечается как подозрительное', () => {
    expect(detectBelowMarket({ price: 1, history: [], unit: 3_000, peers })?.suspicious).toBe(true)
  })
  it('без ₸/м² или с выключенным сигналом — нет', () => {
    expect(detectBelowMarket({ price: 1, history: [], unit: null, peers })).toBeNull()
    expect(
      detectBelowMarket({ price: 1, history: [], unit: 1, peers }, { ...DEFAULT_SETTINGS, belowMarketPct: null })
    ).toBeNull()
  })
})

describe('detectAnomaly и настройки', () => {
  it('выбирает самый сильный сигнал', () => {
    // падение −8% (чуть выше порога 7%) слабее, чем −50% от рынка (порог 20%)
    const a = detectAnomaly({
      price: 92,
      history: [100, 100, 100],
      unit: 5_000,
      peers: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000]
    })
    expect(a?.kind).toBe('market')
  })
  it('настройки из params: широкий режим строже, below_pct только для Krisha', () => {
    expect(settingsOf({ mode: 'broad' }, 'kaspi_category')).toMatchObject({ dropPct: 15, belowMarketPct: null })
    expect(settingsOf({ drop_pct: 5 }, 'kaspi_category').dropPct).toBe(5)
    expect(settingsOf({ below_pct: 30 }, 'krisha_zone').belowMarketPct).toBe(30)
    expect(settingsOf({ drop_pct: 'мусор' }, 'krisha_zone').dropPct).toBe(7)
    expect(settingsOf({ drop_pct: 1000 }, 'krisha_zone').dropPct).toBe(80)
  })
})
