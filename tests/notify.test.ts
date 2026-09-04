import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { Notifier } from '../src/core/notify.js'
import { openDb, upsertUserByTg, createWatcher, insertAlert, updateUser, type DB } from '../src/db/index.js'

let db: DB
let userId = 0
let watcherId = 0

const at = (hhmm: string): Date => new Date(`2026-09-05T${hhmm}:00.000Z`)

beforeEach(() => {
  db = openDb(path.join(process.env.TEMP ?? '/tmp', `cheapkz-notify-${Math.random().toString(36).slice(2)}.db`))
  const u = upsertUserByTg(db, '900', 'quiet-tester')
  userId = u.id
  watcherId = createWatcher(db, { user_id: userId, kind: 'generic', title: 'т', url: 'https://example.com' }).id
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
})

function notifier(sent: string[]): Notifier {
  // UTC как таймзона, чтобы «час» в тесте совпадал с подставленным временем
  const n = new Notifier({ db, brand: 'TestKZ', timezone: 'UTC' })
  n.setSender(async (_tg, html) => void sent.push(html))
  return n
}

describe('тихие часы и мьют откладывают, а не съедают алерты', () => {
  it('в тихие часы обычный алерт остаётся в очереди без потери попыток', async () => {
    updateUser(db, userId, { quiet_from: '23:00', quiet_to: '07:00', break_quiet_on_hot: 1 })
    const a = insertAlert(db, { watcher_id: watcherId, rule: 'drop_pct', level: 'warm', message: 'тихо' })
    const sent: string[] = []
    const n = notifier(sent)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('01:30'))
    // пять циклов доставки: раньше этого хватало, чтобы attempts дошёл до 5 и алерт пропал
    for (let i = 0; i < 5; i++) await n.flushOnce()

    const row = db.prepare(`SELECT attempts, delivered_at FROM alerts WHERE id=?`).get(a.id) as {
      attempts: number
      delivered_at: string | null
    }
    expect(sent).toEqual([])
    expect(row.attempts).toBe(0)
    expect(row.delivered_at).toBeNull()

    // тишина кончилась — алерт уходит
    vi.setSystemTime(at('09:00'))
    expect(await n.flushOnce()).toBe(1)
    expect(sent).toEqual(['тихо'])
  })

  it('горячий алерт пробивает тихие часы', async () => {
    updateUser(db, userId, { quiet_from: '23:00', quiet_to: '07:00', break_quiet_on_hot: 1 })
    insertAlert(db, { watcher_id: watcherId, rule: 'target_hit', level: 'hot', message: '🔥 лови' })
    const sent: string[] = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('02:00'))
    expect(await notifier(sent).flushOnce()).toBe(1)
    expect(sent).toEqual(['🔥 лови'])
  })

  it('мьют откладывает даже горячее', async () => {
    updateUser(db, userId, { muted_until: new Date(Date.now() + 3_600_000).toISOString() })
    const a = insertAlert(db, { watcher_id: watcherId, rule: 'target_hit', level: 'hot', message: '🔥' })
    const sent: string[] = []
    expect(await notifier(sent).flushOnce()).toBe(0)
    const row = db.prepare(`SELECT attempts FROM alerts WHERE id=?`).get(a.id) as { attempts: number }
    expect(row.attempts).toBe(0)
  })

  it('реальная ошибка отправки тратит попытку', async () => {
    const a = insertAlert(db, { watcher_id: watcherId, rule: 'drop_pct', level: 'warm', message: 'x' })
    const n = new Notifier({ db, brand: 'TestKZ', timezone: 'UTC' })
    n.setSender(async () => {
      throw new Error('telegram недоступен')
    })
    await n.flushOnce()
    const row = db.prepare(`SELECT attempts FROM alerts WHERE id=?`).get(a.id) as { attempts: number }
    expect(row.attempts).toBe(1)
  })

  it('удаление наблюдения каскадом уносит его алерты из очереди', async () => {
    const a = insertAlert(db, { watcher_id: watcherId, rule: 'drop_pct', level: 'warm', message: 'x' })
    db.prepare(`DELETE FROM watchers WHERE id=?`).run(watcherId)
    const sent: string[] = []
    expect(await notifier(sent).flushOnce()).toBe(0)
    expect(db.prepare(`SELECT id FROM alerts WHERE id=?`).get(a.id)).toBeUndefined()
    expect(sent).toEqual([])
  })
})
