import { openDb as _openDb, tx, type DB, type RunResult } from './client.js'
import { nowIso } from '../util.js'

export type { DB } from './client.js'
export const openDb = _openDb

// ---------- users ----------
export interface UserRow {
  id: number
  tg_id: string | null
  username: string | null
  lang: string
  digest_hour: number | null
  quiet_from: string | null
  quiet_to: string | null
  break_quiet_on_hot: number
  muted_until: string | null
  is_admin: number
}

export function upsertUserByTg(db: DB, tgId: string, username?: string | null): UserRow {
  db.prepare(
    `INSERT INTO users (tg_id, username) VALUES (?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET username=COALESCE(excluded.username, users.username)`
  ).run(tgId, username ?? null)
  return db.prepare(`SELECT * FROM users WHERE tg_id=?`).get(tgId) as UserRow
}

export function getUserById(db: DB, id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow | undefined
}

export function getUserByTg(db: DB, tgId: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE tg_id=?`).get(tgId) as UserRow | undefined
}

const USER_COLS = ['digest_hour', 'quiet_from', 'quiet_to', 'break_quiet_on_hot', 'muted_until', 'username', 'lang'] as const

export function updateUser(db: DB, id: number, patch: Partial<UserRow>): void {
  const keys = Object.keys(patch).filter((k) => (USER_COLS as readonly string[]).includes(k))
  if (!keys.length) return
  const setSql = keys.map((k) => `${k}=?`).join(', ')
  db.prepare(`UPDATE users SET ${setSql} WHERE id=?`).run(...keys.map((k) => (patch as Record<string, unknown>)[k]), id)
}

// ---------- watchers ----------
export interface WatcherRow {
  id: number
  user_id: number
  kind: string
  title: string
  url: string
  params_json: string
  target_price: number | null
  drop_pct: number | null
  interval_min: number
  active: number
  last_run_at: string | null
  next_run_at: string | null
  last_price: number | null
  prev_price: number | null
  last_score: number | null
  last_level: string | null
  best_title: string | null
  best_url: string | null
  last_error: string | null
  created_at: string
}

export interface NewWatcher {
  user_id: number
  kind: string
  title: string
  url: string
  params_json?: string
  target_price?: number | null
  drop_pct?: number | null
  interval_min?: number
}

export function createWatcher(db: DB, data: NewWatcher): WatcherRow {
  const info = db
    .prepare(
      `INSERT INTO watchers (user_id, kind, title, url, params_json, target_price, drop_pct, interval_min, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      data.user_id,
      data.kind,
      data.title,
      data.url,
      data.params_json ?? '{}',
      data.target_price ?? null,
      data.drop_pct ?? null,
      data.interval_min ?? 30
    )
  return getWatcher(db, Number(info.lastInsertRowid)) as WatcherRow
}

export function getWatcher(db: DB, id: number): WatcherRow | undefined {
  return db.prepare(`SELECT * FROM watchers WHERE id=?`).get(id) as WatcherRow | undefined
}

export function listWatchers(db: DB, userId?: number): WatcherRow[] {
  if (userId != null) {
    return db.prepare(`SELECT * FROM watchers WHERE user_id=? ORDER BY id`).all(userId) as WatcherRow[]
  }
  return db.prepare(`SELECT * FROM watchers ORDER BY id`).all() as WatcherRow[]
}

export function dueWatchers(db: DB, limit: number): WatcherRow[] {
  return db
    .prepare(
      `SELECT * FROM watchers WHERE active=1 AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
       ORDER BY COALESCE(next_run_at,'') LIMIT ?`
    )
    .all(limit) as WatcherRow[]
}

const WATCHER_COLS = [
  'title',
  'url',
  'params_json',
  'target_price',
  'drop_pct',
  'interval_min',
  'active',
  'last_run_at',
  'next_run_at',
  'last_price',
  'prev_price',
  'last_score',
  'last_level',
  'best_title',
  'best_url',
  'last_error'
] as const

export function updateWatcher(db: DB, id: number, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch).filter((k) => (WATCHER_COLS as readonly string[]).includes(k))
  if (!keys.length) return
  const setSql = keys.map((k) => `${k}=?`).join(', ')
  db.prepare(`UPDATE watchers SET ${setSql} WHERE id=?`).run(...keys.map((k) => patch[k]), id)
}

export function deleteWatcherCascade(db: DB, id: number): boolean {
  return tx(db, () => {
    db.prepare(`DELETE FROM alerts WHERE watcher_id=?`).run(id)
    db.prepare(`DELETE FROM offers WHERE watcher_id=?`).run(id)
    db.prepare(`DELETE FROM price_points WHERE watcher_id=?`).run(id)
    return db.prepare(`DELETE FROM watchers WHERE id=?`).run(id).changes > 0
  })
}

// ---------- offers ----------
export interface OfferRow {
  id: number
  watcher_id: number
  external_id: string
  title: string | null
  url: string | null
  seller: string | null
  price: number | null
  old_price: number | null
  currency: string
  in_stock: number
  meta_json: string
  first_seen_at: string
  seen_at: string
}

export function findOffer(db: DB, watcherId: number, externalId: string): OfferRow | undefined {
  return db.prepare(`SELECT * FROM offers WHERE watcher_id=? AND external_id=?`).get(watcherId, externalId) as
    | OfferRow
    | undefined
}

export function upsertOffer(
  db: DB,
  o: Omit<OfferRow, 'id' | 'first_seen_at' | 'seen_at'>
): void {
  db.prepare(
    `INSERT INTO offers (watcher_id, external_id, title, url, seller, price, old_price, currency, in_stock, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(watcher_id, external_id) DO UPDATE SET
       title=excluded.title, url=excluded.url, seller=excluded.seller, price=excluded.price,
       old_price=excluded.old_price, currency=excluded.currency, in_stock=excluded.in_stock,
       meta_json=excluded.meta_json, seen_at=datetime('now')`
  ).run(o.watcher_id, o.external_id, o.title, o.url, o.seller, o.price, o.old_price, o.currency, o.in_stock, o.meta_json)
}

export function countOffersSince(db: DB, iso: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM offers WHERE seen_at >= ?`).get(iso)?.n ?? 0)
}

// ---------- price points ----------
export function addPoint(db: DB, watcherId: number, externalId: string, price: number): void {
  db.prepare(`INSERT INTO price_points (watcher_id, external_id, price) VALUES (?, ?, ?)`).run(
    watcherId,
    externalId,
    price
  )
}

export function lastPoint(
  db: DB,
  watcherId: number,
  externalId = '*'
): { price: number; captured_at: string } | undefined {
  return db
    .prepare(`SELECT price, captured_at FROM price_points WHERE watcher_id=? AND external_id=? ORDER BY id DESC LIMIT 1`)
    .get(watcherId, externalId) as { price: number; captured_at: string } | undefined
}

export function pointHistory(db: DB, watcherId: number, limit = 90, externalId = '*'): number[] {
  const rows = db
    .prepare(`SELECT price FROM price_points WHERE watcher_id=? AND external_id=? ORDER BY id DESC LIMIT ?`)
    .all(watcherId, externalId, limit) as Array<{ price: number }>
  return rows.map((r) => r.price).reverse()
}

export function pointSeries(
  db: DB,
  watcherId: number,
  days: number,
  externalId = '*'
): Array<{ t: string; p: number }> {
  return db
    .prepare(
      `SELECT captured_at AS t, price AS p FROM price_points
       WHERE watcher_id=? AND external_id=? AND captured_at >= datetime('now', ?)
       ORDER BY id ASC`
    )
    .all(watcherId, externalId, `-${Math.max(1, days)} days`) as Array<{ t: string; p: number }>
}

// ---------- alerts ----------
export interface AlertRow {
  id: number
  watcher_id: number
  rule: string
  level: string
  message: string
  price: number | null
  delta: number | null
  attempts: number
  delivered_at: string | null
  digest_sent: number
  created_at: string
}

export function insertAlert(
  db: DB,
  a: Pick<AlertRow, 'watcher_id' | 'rule' | 'level' | 'message'> & { price?: number | null; delta?: number | null }
): AlertRow {
  const info = db
    .prepare(`INSERT INTO alerts (watcher_id, rule, level, message, price, delta) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(a.watcher_id, a.rule, a.level, a.message, a.price ?? null, a.delta ?? null)
  return db.prepare(`SELECT * FROM alerts WHERE id=?`).get(Number(info.lastInsertRowid)) as AlertRow
}

/**
 * Ожидают отправки только алерты тех, у кого есть Telegram: владельцу без бота
 * доставлять некуда, и такие записи иначе вечно крутились бы в очереди.
 */
export function pendingAlerts(db: DB, limit = 50): AlertRow[] {
  return db
    .prepare(
      `SELECT a.* FROM alerts a
       JOIN watchers w ON w.id = a.watcher_id
       JOIN users u ON u.id = w.user_id
       WHERE a.delivered_at IS NULL AND a.attempts < 5 AND u.tg_id IS NOT NULL
       ORDER BY a.id ASC LIMIT ?`
    )
    .all(limit) as AlertRow[]
}

/**
 * Локальный владелец наблюдений, созданных из веб-панели: без него свежая
 * установка без Telegram-бота вообще не даёт ничего создать.
 */
export function ensureLocalUser(db: DB): number {
  const existing = db.prepare(`SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1`).get() as
    | { id: number }
    | undefined
  if (existing) return existing.id
  const info = db.prepare(`INSERT INTO users (tg_id, username, is_admin) VALUES (NULL, 'panel', 1)`).run()
  return Number(info.lastInsertRowid)
}

export function markAlertDelivered(db: DB, id: number): void {
  db.prepare(`UPDATE alerts SET delivered_at=datetime('now') WHERE id=?`).run(id)
}

export function bumpAlertAttempt(db: DB, id: number): void {
  db.prepare(`UPDATE alerts SET attempts=attempts+1 WHERE id=?`).run(id)
}

export function markDigestSent(db: DB, ids: number[]): void {
  if (!ids.length) return
  db.prepare(`UPDATE alerts SET digest_sent=1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
}

export function recentAlerts(db: DB, limit = 30): AlertRow[] {
  return db.prepare(`SELECT * FROM alerts ORDER BY id DESC LIMIT ?`).all(limit) as AlertRow[]
}

export function undigestedForUser(db: DB, userId: number): AlertRow[] {
  return db
    .prepare(
      `SELECT a.* FROM alerts a JOIN watchers w ON w.id=a.watcher_id
       WHERE w.user_id=? AND a.digest_sent=0 AND a.created_at >= datetime('now','-24 hours')
       ORDER BY a.id DESC LIMIT 60`
    )
    .all(userId) as AlertRow[]
}

export function alertsCountSince(db: DB, iso: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE created_at>=?`).get(iso)?.n ?? 0)
}

export function savingsSince(db: DB, iso: string): number {
  return Number(
    db.prepare(`SELECT COALESCE(SUM(delta),0) AS s FROM alerts WHERE delta>0 AND created_at>=?`).get(iso)?.s ?? 0
  )
}

export function hotCountSince(db: DB, iso: string): number {
  return Number(
    db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE level='hot' AND created_at>=?`).get(iso)?.n ?? 0
  )
}

// ---------- kv ----------
export function kvGet(db: DB, key: string): string | null {
  const row = db.prepare(`SELECT v FROM kv WHERE k=?`).get(key) as { v: string | null } | undefined
  return row?.v ?? null
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare(`INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(key, value)
}

export function kvDeletePrefix(db: DB, prefix: string): void {
  db.prepare(`DELETE FROM kv WHERE k LIKE ?`).run(`${prefix}%`)
}

export function kvAllPrefix(db: DB, prefix: string): Record<string, string> {
  const rows = db.prepare(`SELECT k, v FROM kv WHERE k LIKE ?`).all(`${prefix}%`) as Array<{ k: string; v: string }>
  return Object.fromEntries(rows.map((r) => [r.k.slice(prefix.length), r.v]))
}

/** kv с TTL: значение хранится как «<unix-ms истечения>|<значение>». */
export function cacheGet(db: DB, key: string): string | null {
  const raw = kvGet(db, key)
  if (raw == null) return null
  const sep = raw.indexOf('|')
  if (sep < 0) return null
  const exp = Number(raw.slice(0, sep))
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    db.prepare(`DELETE FROM kv WHERE k=?`).run(key)
    return null
  }
  return raw.slice(sep + 1)
}

export function cacheSet(db: DB, key: string, value: string, ttlMs: number): void {
  kvSet(db, key, `${Date.now() + Math.max(0, ttlMs)}|${value}`)
}

/**
 * Чистка старых данных: история цен растёт линейно со временем и без
 * ретеншена превращает SQLite-файл в свалку. Возвращает число удалённых строк.
 */
export function pruneOldData(db: DB, retentionDays: number): number {
  if (retentionDays <= 0) return 0
  const cutoff = `-${Math.round(retentionDays)} days`
  return tx(db, () => {
    let n = db
      .prepare(`DELETE FROM price_points WHERE captured_at < datetime('now', ?)`)
      .run(cutoff).changes
    n += db
      .prepare(`DELETE FROM alerts WHERE delivered_at IS NOT NULL AND created_at < datetime('now', ?)`)
      .run(cutoff).changes
    n += db
      .prepare(`DELETE FROM alerts WHERE delivered_at IS NULL AND attempts >= 5 AND created_at < datetime('now','-7 days')`)
      .run().changes
    n += db.prepare(`DELETE FROM kv WHERE k LIKE 'cd:%' AND v < ?`).run(nowIso()).changes
    return n
  })
}

export function statInc(db: DB, key: string, by = 1): void {
  db.prepare(
    `INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=CAST(CAST(v AS INTEGER)+? AS TEXT)`
  ).run(key, String(by), by)
}

export function statGetNum(db: DB, key: string): number {
  return Number(kvGet(db, key) ?? 0)
}

export type { RunResult }
