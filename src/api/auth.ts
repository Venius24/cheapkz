import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import { upsertUserByTg, type DB, type WatcherRow } from '../db/index.js'

/**
 * Кто смотрит панель:
 *  - admin — владелец по ADMIN_TOKEN (или localhost без токена): видит всё;
 *  - telegram — пользователь Telegram Mini App: видит только своё.
 */
export type Viewer = { mode: 'admin'; userId: null } | { mode: 'telegram'; userId: number; tgId: string; username: string | null }

declare module 'fastify' {
  interface FastifyRequest {
    viewer: Viewer
  }
}

/** initData старше суток не принимаем — иначе утёкшую строку можно крутить вечно. */
const INIT_DATA_MAX_AGE_SEC = 24 * 3600

/**
 * Проверка подписи Telegram WebApp initData:
 * secret = HMAC_SHA256("WebAppData", botToken), hash = HMAC_SHA256(secret, data_check_string).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000)
): { id: string; username: string | null } | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null
  params.delete('hash')
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest()
  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null

  const authDate = Number(params.get('auth_date') ?? 0)
  if (!authDate || nowSec - authDate > INIT_DATA_MAX_AGE_SEC) return null

  try {
    const user = JSON.parse(params.get('user') ?? 'null') as { id?: number; username?: string } | null
    if (!user?.id) return null
    return { id: String(user.id), username: user.username ?? null }
  } catch {
    return null
  }
}

/**
 * Сравнение через SHA-256: буферы всегда одной длины (timingSafeEqual падает
 * на разной) и время ответа не выдаёт длину настоящего токена.
 */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function resolveViewer(req: FastifyRequest, cfg: Config, db: DB): Viewer | null {
  const header = req.headers.authorization ?? ''

  if (header.startsWith('tma ')) {
    if (!cfg.telegramToken) return null
    const tg = verifyInitData(header.slice(4).trim(), cfg.telegramToken)
    if (!tg) return null
    const user = upsertUserByTg(db, tg.id, tg.username)
    return { mode: 'telegram', userId: user.id, tgId: tg.id, username: user.username }
  }

  if (!cfg.adminToken) {
    const ip = req.ip.replace('::ffff:', '')
    return ip === '127.0.0.1' || ip === '::1' ? { mode: 'admin', userId: null } : null
  }
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : new URLSearchParams(req.url.split('?')[1] ?? '').get('token') ?? ''
  if (!token) return null
  return sameSecret(token, cfg.adminToken) ? { mode: 'admin', userId: null } : null
}

/** Админ видит всё, пользователь Telegram — только свои наблюдения и сканы. */
export function canSee(viewer: Viewer, w: Pick<WatcherRow, 'user_id'> | undefined): w is WatcherRow {
  return w != null && (viewer.userId == null || w.user_id === viewer.userId)
}
