import { describe, expect, it } from 'vitest'
import { ProxyPool } from '../src/http/proxies.js'

describe('ProxyPool', () => {
  it('пустой пул -> null', () => {
    expect(new ProxyPool([]).pick()).toBeNull()
  })

  it('ротация по LRU', () => {
    const p = new ProxyPool(['a', 'b'])
    expect(p.pick()).toBe('a')
    expect(p.pick()).toBe('b')
    expect(p.pick()).toBe('a') // a «остыл»
  })

  it('исключает указанный прокси', () => {
    const p = new ProxyPool(['a', 'b'])
    p.pick() // a
    expect(p.pick('b')).toBe('a')
  })

  it('penalize вводит cooldown, reward снимает', () => {
    const p = new ProxyPool(['a', 'b'])
    const first = p.pick()
    p.penalize(first)
    expect(p.pick()).not.toBe(first)
    const snap1 = p.snapshot().find((s) => s.url === first)
    expect(snap1?.cooldownSec).toBeGreaterThan(0)
    p.reward(first)
    expect(p.snapshot().find((s) => s.url === first)?.cooldownSec).toBe(0)
  })

  it('после MAX_FAILS подряд прокси мёртв и не выбирается', () => {
    const p = new ProxyPool(['a', 'b'])
    for (let i = 0; i < 5; i++) p.penalize('a')
    expect(p.snapshot().find((s) => s.url === 'a')?.dead).toBe(true)
    // b жив
    expect(p.pick('zzz')).toBe('b')
  })

  it('cooldown истекает со временем', () => {
    const p = new ProxyPool(['only'])
    const t0 = Date.now()
    void p
    const pool = new ProxyPool(['only'])
    pool.penalize('only', t0)
    expect(pool.aliveCount(t0 + 1000)).toBe(0)
    // шаг 1 = 60с
    expect(pool.aliveCount(t0 + 61_000)).toBe(1)
  })
})
