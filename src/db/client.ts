import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const req = createRequire(import.meta.url)
/* eslint-disable @typescript-eslint/no-explicit-any */
// node:sqlite доступен в Node >= 23 (в 24+ — стабильно). Нативной компиляции нет.
const DatabaseSync: any = req('node:sqlite').DatabaseSync

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Stmt {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): any
  all(...params: unknown[]): any[]
}

export interface DB {
  prepare(sql: string): Stmt
  exec(sql: string): void
  close(): void
}

export function openDb(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db: DB = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  let cur = Number(row?.user_version ?? 0)
  for (; cur < MIGRATIONS.length; cur++) {
    tx(db, () => {
      db.exec(MIGRATIONS[cur])
      db.exec(`PRAGMA user_version = ${cur + 1}`)
    })
  }
}

/** Синхронная транзакция. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id TEXT UNIQUE,
    username TEXT,
    lang TEXT DEFAULT 'ru',
    digest_hour INTEGER,
    quiet_from TEXT,
    quiet_to TEXT,
    break_quiet_on_hot INTEGER DEFAULT 1,
    muted_until TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    params_json TEXT NOT NULL DEFAULT '{}',
    target_price REAL,
    drop_pct REAL,
    interval_min INTEGER NOT NULL DEFAULT 30,
    active INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    last_price REAL,
    prev_price REAL,
    last_score INTEGER,
    last_level TEXT,
    best_title TEXT,
    best_url TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_watchers_due ON watchers(active, next_run_at);

  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id INTEGER NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT,
    url TEXT,
    seller TEXT,
    price REAL,
    old_price REAL,
    currency TEXT DEFAULT 'KZT',
    in_stock INTEGER DEFAULT 1,
    meta_json TEXT DEFAULT '{}',
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(watcher_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS price_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id INTEGER NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL DEFAULT '*',
    price REAL NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_points_w ON price_points(watcher_id, external_id, id);

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id INTEGER NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    price REAL,
    delta REAL,
    attempts INTEGER NOT NULL DEFAULT 0,
    delivered_at TEXT,
    digest_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_pending ON alerts(delivered_at, created_at);

  CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    ok_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    fail_streak INTEGER NOT NULL DEFAULT 0,
    cooldown_until TEXT,
    alive INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
  );
  `
]
