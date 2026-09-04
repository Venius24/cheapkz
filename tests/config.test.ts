import { describe, expect, it } from 'vitest'
import { loadConfig, validateConfig } from '../src/config.js'

const base = { telegramToken: null, tpToken: null, proxies: [] as string[] }

describe('loadConfig', () => {
  it('перевёрнутый диапазон задержек нормализуется', () => {
    process.env.MIN_DELAY_MS = '2400..900'
    expect(loadConfig().minDelayMs).toEqual([900, 2400])
    process.env.MIN_DELAY_MS = '1500'
    expect(loadConfig().minDelayMs).toEqual([1500, 1500])
    delete process.env.MIN_DELAY_MS
  })

  it('мусорный LOG_LEVEL не ломает логгер', () => {
    process.env.LOG_LEVEL = 'ЧТО-ТО'
    expect(loadConfig().logLevel).toBe('info')
    delete process.env.LOG_LEVEL
  })

  it('MAX_CONCURRENCY зажимается в разумные границы', () => {
    process.env.MAX_CONCURRENCY = '0'
    expect(loadConfig().maxConcurrency).toBe(1)
    process.env.MAX_CONCURRENCY = '9999'
    expect(loadConfig().maxConcurrency).toBe(32)
    delete process.env.MAX_CONCURRENCY
  })
})

describe('validateConfig', () => {
  it('в проде пустой ADMIN_TOKEN — ошибка, в разработке — предупреждение', () => {
    const prod = validateConfig(loadConfig({ ...base, env: 'production', adminToken: null }))
    expect(prod.some((i) => i.level === 'error' && /ADMIN_TOKEN/.test(i.text))).toBe(true)
    const dev = validateConfig(loadConfig({ ...base, env: 'development', adminToken: null }))
    expect(dev.every((i) => i.level === 'warn')).toBe(true)
  })

  it('токен по умолчанию из .env.example не считается настроенным', () => {
    const issues = validateConfig(
      loadConfig({ ...base, env: 'production', adminToken: 'change-me-to-long-random-string' })
    )
    expect(issues.some((i) => i.level === 'error')).toBe(true)
  })

  it('нормальная продакшен-конфигурация проходит без ошибок', () => {
    const issues = validateConfig(
      loadConfig({
        ...base,
        env: 'production',
        adminToken: 'a'.repeat(64),
        baseUrl: 'https://cheap.example.kz'
      })
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('отключённая SSRF-защита и http в проде подсвечиваются', () => {
    const issues = validateConfig(
      loadConfig({
        ...base,
        env: 'production',
        adminToken: 'a'.repeat(64),
        baseUrl: 'http://cheap.example.kz',
        allowPrivateTargets: true
      })
    )
    expect(issues.some((i) => /HTTPS/.test(i.text))).toBe(true)
    expect(issues.some((i) => /SSRF/.test(i.text))).toBe(true)
  })
})
