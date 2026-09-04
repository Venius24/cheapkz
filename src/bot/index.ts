import { Bot, InlineKeyboard, type Context } from 'grammy'
import type { Config } from '../config.js'
import {
  upsertUserByTg,
  getUserByTg,
  updateUser,
  createWatcher,
  listWatchers,
  deleteWatcherCascade,
  updateWatcher,
  pointSeries,
  getWatcher,
  type DB,
  type UserRow,
  type WatcherRow
} from '../db/index.js'
import { detectKind, getAdapter } from '../sources/index.js'
import { kaspiProductSlug, slugTitle } from '../sources/kaspi.js'
import { money, timeAgoRu } from '../util.js'
import { log } from '../log.js'

export interface BotDeps {
  cfg: Config
  db: DB
  scheduler: {
    runById(id: number, userId?: number): Promise<{ offers: number; alerts: number; bestPrice: number | null }>
  }
}

const KIND_ICON: Record<string, string> = {
  kaspi: '🛒',
  olx: '🛍',
  krisha: '🏠',
  flights: '✈️',
  generic: '🌐'
}

const HELP = `<b>Как пользоваться</b>
Просто пришли мне ссылку:
🛒 Kaspi — ссылку на товар (/p/…)
🛍 OLX — ссылку поиска (…/q-запрос/)
🏠 Krisha — ссылку выдачи аренды

Команды:
/list — наблюдения с кнопками
/set id цена — целевая цена
/drop id % — алерт при падении на N%
/flights ALA NQZ 2026-09-12 [обратно] — билеты
/hot — горячие сделки прямо сейчас
/stats — статистика
/mute 2h — тишина на срок
/digest 9 — сводка каждый день в 9:00
/quiet 23:00 07:00 — тихие часы
/delete id

Алгоритм «ЛОВИ СЕЙЧАС» 🔥 сам кричит, когда цена аномально хороша.`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function badge(level: string | null | undefined, score: number | null | undefined): string {
  if (level == null) return ''
  const icon = level === 'hot' ? '🔥' : level === 'warm' ? '🌤' : '❄️'
  return `${icon} ${score ?? '—'}/100`
}

function defaultTitle(kind: string, url: string): string {
  if (kind === 'kaspi' && kaspiProductSlug(url)) return slugTitle(kaspiProductSlug(url) as string).slice(0, 80)
  try {
    const u = new URL(url)
    return u.hostname.replace('www.', '') + (u.pathname !== '/' ? u.pathname.slice(0, 60) : '')
  } catch {
    return url.slice(0, 60) || 'Наблюдение'
  }
}

function card(w: WatcherRow): string {
  const icon = KIND_ICON[w.kind] ?? '•'
  const price = w.last_price != null ? money(w.last_price) : 'ещё не проверялось'
  const err = w.last_error ? `\n⚠️ ${esc(w.last_error.slice(0, 160))}` : ''
  const target = w.target_price != null ? `\n🎯 Цель: ${money(w.target_price)}` : ''
  const drop = w.drop_pct != null ? `\n📉 Алерт при падении ≥${w.drop_pct}%` : ''
  return (
    `${icon} <b>#${w.id} ${esc(w.title)}</b>\n` +
    `💰 ${price} ${badge(w.last_level, w.last_score)}` +
    `${target}${drop}\n` +
    `⏱ Проверка: ${timeAgoRu(w.last_run_at)} · интервал ${w.interval_min} мин` +
    (w.url ? `\n🔗 ${esc(w.url)}` : '') +
    err
  )
}

function rowsKeyboard(rows: WatcherRow[]) {
  return rows.map((w) => [
    { text: `${w.active ? '' : '⏸ '}${KIND_ICON[w.kind] ?? '•'} #${w.id} ${w.title.slice(0, 26)}`, callback_data: `show:${w.id}` },
    { text: '↻', callback_data: `run:${w.id}` },
    { text: w.active ? '⏸' : '▶', callback_data: `toggle:${w.id}` },
    { text: '🗑', callback_data: `del:${w.id}` }
  ])
}

export function createBot(deps: BotDeps): Bot {
  const { db, cfg } = deps
  const bot = new Bot(cfg.telegramToken as string)
  // ожидание ввода целевой цены живёт 5 минут: иначе случайное число
  // спустя часы внезапно станет целью для давно забытого наблюдения
  const pendingTarget = new Map<number, { watcherId: number; expires: number }>()
  const PENDING_TTL_MS = 5 * 60_000

  const takePending = (chatId: number | undefined): number | null => {
    if (chatId == null) return null
    const p = pendingTarget.get(chatId)
    if (!p) return null
    pendingTarget.delete(chatId)
    return p.expires > Date.now() ? p.watcherId : null
  }

  bot.use(async (ctx, next) => {
    try {
      if (ctx.from) upsertUserByTg(db, String(ctx.from.id), ctx.from.username ?? null)
      await next()
    } catch (e) {
      log.error('bot middleware', e)
    }
  })

  const userOf = (ctx: Context): UserRow | undefined => getUserByTg(db, String(ctx.from?.id ?? ''))

  const owned = (user: UserRow | undefined, idStr: string | undefined): WatcherRow | undefined => {
    if (!user || !idStr || !/^\d+$/.test(idStr)) return undefined
    const w = getWatcher(db, Number(idStr))
    return w && w.user_id === user.id ? w : undefined
  }

  bot.command('start', async (ctx) => {
    await ctx.reply(`👋 Привет! Я ${cfg.brand} — слежу за ценами по Казахстану и кричу «ЛОВИ СЕЙЧАС», когда падают.\n\nПришли ссылку с Kaspi / OLX / Krisha — и всё.\n\n${HELP}`, { parse_mode: 'HTML' })
  })
  bot.command('help', async (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }))

  bot.command('list', async (ctx) => {
    const user = userOf(ctx)
    if (!user) return
    const rows = listWatchers(db, user.id)
    if (!rows.length) return void ctx.reply('Пока пусто. Пришли ссылку 🛒')
    await ctx.reply(`📋 Наблюдений: ${rows.length}`, { reply_markup: { inline_keyboard: rowsKeyboard(rows) }, parse_mode: 'HTML' })
  })

  bot.command('set', async (ctx) => {
    const [, idStr, priceStr] = ctx.message?.text?.split(/\s+/) ?? []
    const w = owned(userOf(ctx), idStr)
    const price = priceStr?.replace(/\D/g, '')
    if (!w || !price) return void ctx.reply('Формат: <code>/set 12 199990</code>', { parse_mode: 'HTML' })
    updateWatcher(db, w.id, { target_price: Number(price) })
    await ctx.reply(`🎯 Цель для #${w.id}: ${money(Number(price))}`)
  })

  bot.command('drop', async (ctx) => {
    const [, idStr, pctStr] = ctx.message?.text?.split(/\s+/) ?? []
    const w = owned(userOf(ctx), idStr)
    if (!w || !pctStr || !/^\d+([.,]\d+)?$/.test(pctStr)) {
      return void ctx.reply('Формат: <code>/drop 12 15</code> — алерт при падении ≥15%', { parse_mode: 'HTML' })
    }
    updateWatcher(db, w.id, { drop_pct: Number(pctStr.replace(',', '.')) })
    await ctx.reply(`📉 Следить за падением ≥${pctStr}% для #${w.id}`)
  })

  bot.command('delete', async (ctx) => {
    const [, idStr] = ctx.message?.text?.split(/\s+/) ?? []
    const w = owned(userOf(ctx), idStr)
    if (!w) return void ctx.reply('Формат: <code>/delete 12</code>', { parse_mode: 'HTML' })
    deleteWatcherCascade(db, w.id)
    await ctx.reply(`🗑 #${w.id} удалено`)
  })

  bot.command('flights', async (ctx) => {
    const parts = (ctx.message?.text ?? '').split(/\s+/).slice(1)
    const user = userOf(ctx)
    if (!user) return
    if (parts.length < 2 || !/^[a-z]{3}$/i.test(parts[0]) || !/^[a-z]{3}$/i.test(parts[1])) {
      return void ctx.reply('Формат: <code>/flights ALA NQZ 2026-09-12 [2026-09-19]</code>', { parse_mode: 'HTML' })
    }
    const params: Record<string, unknown> = { origin: parts[0], destination: parts[1], one_way: true }
    let title = `${parts[0].toUpperCase()}→${parts[1].toUpperCase()}`
    if (parts[2] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
      params.depart_date = parts[2]
      title += ` ${parts[2]}`
    }
    if (parts[3] && /^\d{4}-\d{2}-\d{2}$/.test(parts[3])) {
      params.return_date = parts[3]
      params.one_way = false
      title += ` – ${parts[3]}`
    }
    const w = createWatcher(db, {
      user_id: user.id,
      kind: 'flights',
      title: `✈️ ${title}`,
      url: '',
      params_json: JSON.stringify(params),
      interval_min: 120
    })
    await ctx.reply(
      `✈️ Слежу за билетами #${w.id}: <b>${esc(title)}</b>\nПроверка каждые 2 часа. Нужен токен TRAVELPAYOUTS_TOKEN в .env.`,
      { parse_mode: 'HTML' }
    )
    deps.scheduler.runById(w.id, user.id).catch(() => {})
  })

  bot.command('hot', async (ctx) => {
    const user = userOf(ctx)
    if (!user) return
    const rows = listWatchers(db, user.id)
      .filter((w) => w.last_price != null && w.active)
      .sort((a, b) => (b.last_score ?? 0) - (a.last_score ?? 0))
      .slice(0, 8)
    if (!rows.length) return void ctx.reply('Данных пока нет — дай ссылки, и я начну охоту 🔍')
    const lines = rows.map((w, i) => `${i + 1}. ${badge(w.last_level, w.last_score)} ${esc(w.title)} — ${money(w.last_price)}`)
    await ctx.reply(`🔥 <b>Сейчас самое горячее:</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' })
  })

  bot.command('stats', async (ctx) => {
    const user = userOf(ctx)
    if (!user) return
    const rows = listWatchers(db, user.id)
    await ctx.reply(
      `📊 <b>Статистика</b>\nНаблюдений: ${rows.length} · активных: ${rows.filter((r) => r.active).length}\nГорячих сейчас: ${rows.filter((r) => r.last_level === 'hot').length}`,
      { parse_mode: 'HTML' }
    )
  })

  bot.command('mute', async (ctx) => {
    const arg = ctx.message?.text?.split(/\s+/)[1] ?? ''
    const m = arg.match(/^(\d+)\s*(m|h|d)$/i)
    const user = userOf(ctx)
    if (!m || !user) return void ctx.reply('Формат: <code>/mute 2h</code> (30m, 2h, 1d)', { parse_mode: 'HTML' })
    const mult = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as 'm' | 'h' | 'd']
    const until = new Date(Date.now() + Number(m[1]) * mult).toISOString()
    updateUser(db, user.id, { muted_until: until })
    await ctx.reply(`🔇 Тишина до ${until.slice(0, 16).replace('T', ' ')}`)
  })

  bot.command('digest', async (ctx) => {
    const arg = ctx.message?.text?.split(/\s+/)[1]
    const user = userOf(ctx)
    if (!user) return
    if (!arg || arg === 'off') {
      updateUser(db, user.id, { digest_hour: null })
      return void ctx.reply('📭 Дайджест выключен')
    }
    const h = Number(arg)
    if (!(Number.isInteger(h) && h >= 0 && h <= 23)) {
      return void ctx.reply('Формат: <code>/digest 9</code> (час 0–23)', { parse_mode: 'HTML' })
    }
    updateUser(db, user.id, { digest_hour: h })
    await ctx.reply(`🌅 Дайджест каждый день в ${h}:00 (${cfg.timezone})`)
  })

  bot.command('quiet', async (ctx) => {
    const [, from, to] = ctx.message?.text?.split(/\s+/) ?? []
    const user = userOf(ctx)
    if (!user) return
    if (from === 'off') {
      updateUser(db, user.id, { quiet_from: null, quiet_to: null })
      return void ctx.reply('🔕 Тихие часы выключены')
    }
    if (!from || !to || !/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) {
      return void ctx.reply('Формат: <code>/quiet 23:00 07:00</code>. Горячие 🔥 пробиваются.', { parse_mode: 'HTML' })
    }
    updateUser(db, user.id, { quiet_from: from.padStart(5, '0'), quiet_to: to.padStart(5, '0') })
    await ctx.reply(`🌙 Тихие часы ${from}–${to}. Горячие алерты 🔥 прорываются.`)
  })

  // Ссылки -> мгновенное наблюдение
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim()
    const chatId = ctx.chat?.id

    // ввод целевой цены после кнопки «Задать целевую цену»
    if (/^\d{3,}$/.test(text)) {
      const pendingId = takePending(chatId)
      if (pendingId != null && owned(userOf(ctx), String(pendingId))) {
        updateWatcher(db, pendingId, { target_price: Number(text) })
        return void ctx.reply(`🎯 Цель для #${pendingId}: ${money(Number(text))}`)
      }
    }

    const m = text.match(/https?:\/\/\S+/i)
    if (!m) return void ctx.reply('Не понял 🙂 Пришли ссылку (Kaspi / OLX / Krisha) или /help')
    const url = m[0].replace(/[)\],.]+$/, '')
    const kind = detectKind(url)

    if (kind === 'generic') {
      return void ctx.reply(
        'Не распознал источник. Поддерживаю:\n🛒 kaspi.kz/p/товар/\n🛍 olx.kz/…/q-запрос/\n🏠 krisha.kz (выдача)\n✈️ «/flights ALA NQZ 2026-09-12»'
      )
    }

    const adapter = getAdapter(kind)
    const user = userOf(ctx)
    if (!user) return
    const norm = (u: string): string => u.split('?')[0].replace(/\/+$/, '').toLowerCase()
    const dup = listWatchers(db, user.id).find((w) => w.url && norm(w.url) === norm(url))
    if (dup) return void ctx.reply(`Такое наблюдение уже есть: #${dup.id} «${esc(dup.title)}»`, { parse_mode: 'HTML' })

    const w = createWatcher(db, {
      user_id: user.id,
      kind,
      title: defaultTitle(kind, url),
      url,
      interval_min: 30
    })

    const kb = new InlineKeyboard()
      .text('↻ Проверить сейчас', `run:${w.id}`)
      .text('⏸', `toggle:${w.id}`)
      .row()
      .text('🎯 Задать целевую цену', `target:${w.id}`)

    await ctx.reply(
      `✅ Слежу! ${KIND_ICON[kind]} <b>${esc(adapter.label)}</b>\n#${w.id} «${esc(w.title)}»\nИнтервал: каждые 30 мин.\nЦель: <code>/set ${w.id} цена</code> · Падение: <code>/drop ${w.id} %</code>`,
      { parse_mode: 'HTML', reply_markup: kb }
    )
    deps.scheduler.runById(w.id, user.id).catch(() => {})
  })

  bot.on('callback_query:data', async (ctx) => {
    const [action, idStr] = ctx.callbackQuery.data.split(':')
    const user = userOf(ctx)
    const w = owned(user, idStr)
    if (!user || !w) return void ctx.answerCallbackQuery({ text: 'Недоступно' })

    if (action === 'toggle') {
      updateWatcher(db, w.id, { active: w.active ? 0 : 1 })
      await ctx.answerCallbackQuery({ text: w.active ? 'Пауза ⏸' : 'Возобновлено ▶' })
    } else if (action === 'del') {
      deleteWatcherCascade(db, w.id)
      await ctx.answerCallbackQuery({ text: 'Удалено 🗑' })
    } else if (action === 'run') {
      await ctx.answerCallbackQuery({ text: 'Проверяю…' })
      try {
        const r = await deps.scheduler.runById(w.id, user.id)
        const nw = getWatcher(db, w.id)
        await ctx.reply(`↻ #${w.id}: предложений ${r.offers}, лучшая ${money(nw?.last_price)}, новых алертов ${r.alerts}`)
      } catch (e) {
        await ctx.reply(`⚠️ ${e instanceof Error ? e.message : 'ошибка проверки'}`.slice(0, 300))
      }
    } else if (action === 'show') {
      await ctx.answerCallbackQuery()
      const series = pointSeries(db, w.id, 7)
      const min = series.length ? Math.min(...series.map((p) => p.p)) : null
      await ctx.reply(card(w) + (min != null && min !== w.last_price ? `\n📉 Минимум за 7 дней: ${money(min)}` : ''), {
        parse_mode: 'HTML'
      })
    } else if (action === 'target') {
      const chatId = ctx.chat?.id
      if (chatId != null) pendingTarget.set(chatId, { watcherId: w.id, expires: Date.now() + PENDING_TTL_MS })
      await ctx.answerCallbackQuery()
      await ctx.reply(`Отправь число — целевую цену для #${w.id} (например 199990)`)
    }
  })

  // меню команд в клиенте Telegram — иначе про них знает только тот, кто читал /help
  void bot.api
    .setMyCommands([
      { command: 'list', description: 'мои наблюдения' },
      { command: 'hot', description: 'горячие сделки сейчас' },
      { command: 'set', description: 'целевая цена: /set 12 199990' },
      { command: 'drop', description: 'алерт при падении: /drop 12 15' },
      { command: 'flights', description: 'билеты: /flights ALA NQZ 2026-09-12' },
      { command: 'stats', description: 'статистика' },
      { command: 'digest', description: 'ежедневная сводка: /digest 9' },
      { command: 'quiet', description: 'тихие часы: /quiet 23:00 07:00' },
      { command: 'mute', description: 'тишина на срок: /mute 2h' },
      { command: 'delete', description: 'удалить: /delete 12' },
      { command: 'help', description: 'справка' }
    ])
    .catch((e) => log.warn('не удалось задать меню команд', e))

  bot.catch((err) => log.error('bot error', err.error))
  return bot
}
