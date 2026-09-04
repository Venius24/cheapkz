import { describe, expect, it, vi } from 'vitest'
import { RateLimiter, Breaker } from '../src/http/limiter.js'
import { sleep } from '../src/util.js'

describe('RateLimiter (реальные таймеры)', () => {
  function make(over: Partial<ConstructorParameters<typeof RateLimiter>[0]> = {}) {
    return new RateLimiter({
      capacity: 2,
      refillMs: 150,
      maxConcurrent: 10,
      jitterMs: [0, 0],
      ...over
    })
  }

  it('даёт burst = capacity, затем ждёт refill', async () => {
    const rl = make()
    const r1 = await rl.acquire('h')
    const r2 = await rl.acquire('h')
    let thirdDone = false
    const p3 = rl.acquire('h').then((r) => {
      thirdDone = true
      return r
    })
    await sleep(30)
    expect(thirdDone).toBe(false)
    r1()
    r2()
    const t0 = Date.now()
    const r3 = await p3
    expect(thirdDone).toBe(true)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100)
    r3()
    vi.restoreAllMocks()
  })

  it('ограничивает параллелизм', async () => {
    const rl = make({ capacity: 100, refillMs: 1, maxConcurrent: 2 })
    let concurrent = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const rel = await rl.acquire('x')
        concurrent++
        peak = Math.max(peak, concurrent)
        await sleep(40)
        concurrent--
        rel()
      })
    )
    expect(peak).toBeLessThanOrEqual(2)
  }, 15_000)

  it('hostOverrides замедляют конкретный домен', async () => {
    const rl = make({ hostOverrides: { 'slow.kz': { refillMs: 400, capacity: 1 } } })
    const a = await rl.acquire('slow.kz')
    let secondDone = false
    void rl.acquire('slow.kz').then(() => {
      secondDone = true
    })
    a()
    await sleep(120)
    expect(secondDone).toBe(false)
    await sleep(500)
    expect(secondDone).toBe(true)
  }, 15_000)

  it('jitter в заданном диапазоне', async () => {
    const t0 = Date.now()
    const rl = make({ capacity: 50, refillMs: 1, jitterMs: [80, 140] })
    const rel = await rl.acquire('j')
    const dt = Date.now() - t0
    rel()
    expect(dt).toBeGreaterThanOrEqual(70)
    expect(dt).toBeLessThan(400)
  }, 15_000)
})

describe('Breaker', () => {
  it('открывается после threshold и закрывается по успеху/времени', () => {
    const b = new Breaker(3, 1000)
    const t = Date.now()
    expect(b.can('d', t)).toBe(true)
    b.fail('d', t)
    b.fail('d', t)
    expect(b.can('d', t)).toBe(true)
    b.fail('d', t)
    expect(b.can('d', t)).toBe(false)
    expect(b.retryAfter('d', t)).toBeGreaterThan(0)
    b.success('d')
    expect(b.can('d', t)).toBe(true)

    b.fail('d2', t)
    b.fail('d2', t)
    b.fail('d2', t)
    expect(b.can('d2', t)).toBe(false)
    expect(b.can('d2', t + 1500)).toBe(true)
  })
})
