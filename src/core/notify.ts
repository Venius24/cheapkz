import {
  getUserById,
  markAlertDelivered,
  bumpAlertAttempt,
  pendingAlerts,
  undigestedForUser,
  markDigestSent,
  type AlertRow,
  type DB,
  type UserRow
} from '../db/index.js'
import { inQuietRange, tzClock, sleep } from '../util.js'
import { buildDigestMessage } from './format.js'
import { log } from '../log.js'

export type Sender = (tgId: string, html: string) => Promise<void>

/**
 * sent — доставлено; deferred — сейчас нельзя (мьют/тихие часы), попробуем позже
 * и попытку НЕ засчитываем; failed — доставка сорвалась, попытка засчитывается.
 */
export type DeliveryResult = 'sent' | 'deferred' | 'failed'

interface NotifyDeps {
  db: DB
  brand: string
  timezone: string
}

/**
 * Доставка алертов в Telegram с учётом:
 * — тихих часов (кроме «горячих», если пользователь разрешил прорыв),
 * — режима мьюта,
 * — ежедневного дайджеста.
 */
export class Notifier {
  private sender: Sender | null = null
  private running = false

  constructor(private deps: NotifyDeps) {}

  setSender(s: Sender): void {
    this.sender = s
  }

  hasSender(): boolean {
    return this.sender != null
  }

  async deliver(alert: AlertRow, user: UserRow): Promise<DeliveryResult> {
    if (!this.sender) return 'deferred'
    if (!user.tg_id) return 'failed'
    // мьют и тихие часы — это отсрочка, а не потеря алерта
    if (user.muted_until && new Date(user.muted_until).getTime() > Date.now()) return 'deferred'
    const { hhmm } = tzClock(this.deps.timezone)
    const quiet = inQuietRange(hhmm, user.quiet_from, user.quiet_to)
    if (quiet && !(alert.level === 'hot' && user.break_quiet_on_hot)) return 'deferred'
    try {
      await this.sender(user.tg_id, alert.message)
      return 'sent'
    } catch (e) {
      log.warn('telegram send failed', e)
      return 'failed'
    }
  }

  /** Цикл доставки ожидающих алертов. Вызывается по таймеру. */
  async flushOnce(): Promise<number> {
    if (!this.sender || this.running) return 0
    this.running = true
    try {
      const pending = pendingAlerts(this.deps.db, 50)
      let sent = 0
      for (const a of pending) {
        const watcher = this.deps.db.prepare(`SELECT user_id FROM watchers WHERE id=?`).get(a.watcher_id) as
          | { user_id: number }
          | undefined
        if (!watcher) {
          markAlertDelivered(this.deps.db, a.id)
          continue
        }
        const user = getUserById(this.deps.db, watcher.user_id)
        const res: DeliveryResult = user ? await this.deliver(a, user) : 'failed'
        if (res === 'sent') {
          markAlertDelivered(this.deps.db, a.id)
          sent++
        } else if (res === 'failed') {
          bumpAlertAttempt(this.deps.db, a.id)
        }
        // 'deferred' — оставляем как есть: попытка не тратится, вернёмся позже
        if (res !== 'deferred') await sleep(120)
      }
      return sent
    } finally {
      this.running = false
    }
  }

  /** Ежедневный дайджест для всех, у кого наступил час. */
  async runDigests(hour: number): Promise<void> {
    if (!this.sender) return
    const users = this.deps.db.prepare(`SELECT id FROM users WHERE digest_hour=?`).all(hour) as Array<{ id: number }>
    for (const u of users) {
      const full = getUserById(this.deps.db, u.id)
      if (!full?.tg_id || full.muted_until && new Date(full.muted_until).getTime() > Date.now()) continue
      const alerts = undigestedForUser(this.deps.db, u.id)
      if (!alerts.length) continue
      const titles = alerts.map((a) => ({
        level: a.level,
        message: a.message,
        title: a.message.replace(/<[^>]+>/g, ' ').trim().split('\n')[0].slice(0, 90)
      }))
      try {
        await this.sender(full.tg_id, buildDigestMessage(this.deps.brand, titles))
        markDigestSent(
          this.deps.db,
          alerts.map((a) => a.id)
        )
      } catch (e) {
        log.warn('digest send failed', e)
      }
    }
  }
}
