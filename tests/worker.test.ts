import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { runWatcher } from '../src/worker/index.js'
import type { Config } from '../src/config.js'
import { HttpGuard } from '../src/http/client.js'
import { ProxyPool } from '../src/http/proxies.js'
import { Notifier } from '../src/core/notify.js'
import path from 'node:path'

const cfg: Config = {
  env: 'test',
  version: '0',
  brand: 'TestKZ',
  port: 0,
  baseUrl: 'http://localhost',
  dataDir: '.',
  dbPath: path.join(process.env.TEMP ?? '/tmp', `cheapkz-worker-${Math.random().toString(36).slice(2)}.db`),
  adminToken: null,
  telegramToken: null,
  tpToken: null,
  proxies: [],
  userAgent: null,
  timezone: 'Asia/Almaty',
  logLevel: 'error',
  maxConcurrency: 1,
  minDelayMs: [0, 0],
  allowPrivateTargets: true,
  retentionDays: 365
}

describe('runWatcher pipeline (с фейковым адаптером через generic+локальный guard)', () => {
  it('ошибка сети помечает watcher и переносит next_run', async () => {
    const db = openDb(cfg.dbPath)
    const guard = new HttpGuard(cfg, db, new ProxyPool([]))
    const notifier = new Notifier({ db, brand: cfg.brand, timezone: cfg.timezone })
    const user = openDb(cfg.dbPath)
      .prepare(`INSERT INTO users (tg_id) VALUES ('777') RETURNING id`)
      .get() as { id: number }
    void user
    const w = db
      .prepare(
        `INSERT INTO watchers (user_id, kind, title, url, interval_min, next_run_at)
         VALUES ((SELECT id FROM users WHERE tg_id='777'), 'generic', 't', 'http://127.0.0.1:1/nope', 30, datetime('now')) RETURNING id`
      )
      .get() as { id: number }

    await expect(runWatcher({ cfg, db, guard, notifier }, w.id)).rejects.toThrow()
    const row = db.prepare(`SELECT last_error, next_run_at FROM watchers WHERE id=?`).get(w.id) as {
      last_error: string | null
      next_run_at: string
    }
    expect(row.last_error).toBeTruthy()
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now())
    db.close()
  })
})
