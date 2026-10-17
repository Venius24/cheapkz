import { escapeHtml, money } from '../util.js'
import type { ScoreResult } from './hotScore.js'
import type { Offer } from '../sources/types.js'
import type { WatcherRow } from '../db/index.js'

export const LEVEL_BADGE: Record<string, string> = {
  hot: '🚨 ЛОВИ СЕЙЧАС 🔥',
  warm: '🌤 Хороший момент',
  cool: '❄️ Спокойно'
}

export interface AlertContext {
  watcher: Pick<WatcherRow, 'id' | 'title' | 'kind' | 'target_price' | 'drop_pct' | 'url'>
  offer: Offer
  score: ScoreResult
  prevPrice?: number | null
}

export function buildAlertMessage(ctx: AlertContext, ruleLabel: string): string {
  const { watcher: w, offer: o, score } = ctx
  const lines: string[] = []
  if (score.level === 'hot') lines.push(`🚨 <b>ЛОВИ СЕЙЧАС</b> 🔥`)
  lines.push(`<b>${escapeHtml(o.title || w.title)}</b>`)

  const priceStr = money(o.price, o.currency)
  if (o.oldPrice != null && o.oldPrice > (o.price ?? 0)) {
    lines.push(`💰 <b>${priceStr}</b>  <s>${money(o.oldPrice, o.currency)}</s>`)
  } else {
    lines.push(`💰 <b>${priceStr}</b>`)
  }

  const details: string[] = [score.reason]
  if (ruleLabel) details.push(ruleLabel)
  if (w.target_price != null && o.price != null && o.price <= w.target_price) {
    details.push(`🎯 цель ${money(w.target_price)} достигнута ✅`)
  }
  if (ctx.prevPrice != null && o.price != null && o.price < ctx.prevPrice) {
    details.push(`📉 было ${money(ctx.prevPrice, o.currency)}`)
  }
  lines.push(escapeHtml(details.filter(Boolean).join(' · ')))

  lines.push(`👀 ${escapeHtml(w.title)}  <a href="${escapeHtml(o.url || w.url)}">открыть →</a>`)
  return lines.join('\n')
}

export interface AnomalyMessageCtx {
  source: 'krisha' | 'kaspi'
  title: string
  url: string
  zoneLabel: string
  price: number
  /** Норма: медиана рынка (₸/м²) или обычная цена позиции */
  ref: number
  pct: number
  kind: 'drop' | 'market'
  level: 'hot' | 'warm'
  suspicious: boolean
  reason: string
  unit?: number | null
  address?: string | null
  prevPrice?: number | null
}

export function buildAnomalyMessage(a: AnomalyMessageCtx): string {
  const lines: string[] = []
  const head = a.source === 'krisha' ? '🏠 Аномально дёшево' : '🛒 Аномалия цены Kaspi'
  lines.push(`${a.level === 'hot' ? '🚨 ' : ''}<b>${head}</b> · ${escapeHtml(a.zoneLabel)}${a.level === 'hot' ? ' 🔥' : ''}`)
  lines.push(`<b>${escapeHtml(a.title)}</b>`)
  if (a.address) lines.push(`📍 ${escapeHtml(a.address)}`)
  if (a.kind === 'market') {
    lines.push(`💰 <b>${money(a.price)}</b> · ${money(a.unit)}/м² — у похожих в районе ${money(a.ref)}/м²`)
  } else {
    lines.push(`💰 <b>${money(a.price)}</b>  <s>${money(a.ref)}</s>  <b>−${Math.round(a.pct)}%</b>`)
  }
  const details = [a.reason]
  if (a.prevPrice != null && a.prevPrice > a.price && a.kind === 'market') details.push(`📉 было ${money(a.prevPrice)}`)
  lines.push(escapeHtml(details.join(' · ')))
  if (a.suspicious) lines.push('⚠️ <i>Слишком дёшево для рынка — проверьте объявление, так часто выглядят ошибки и мошенники.</i>')
  lines.push(`<a href="${escapeHtml(a.url)}">открыть →</a>`)
  return lines.join('\n')
}

export function buildDigestMessage(brand: string, items: Array<{ level: string; message: string; title: string }>): string {
  const hot = items.filter((i) => i.level === 'hot').length
  const head = `🌅 <b>Дайджест ${escapeHtml(brand)}</b> за сутки — алертов: <b>${items.length}</b>${hot ? `, горячих: <b>${hot}</b> 🔥` : ''}`
  const body = items
    .slice(0, 25)
    .map((i) => `${i.level === 'hot' ? '🔥' : i.level === 'warm' ? '🌤' : '❄️'} ${escapeHtml(i.title)}`)
    .join('\n')
  return `${head}\n\n${body}\n\n<i>Полные карточки — в истории бота и веб-панели.</i>`
}

export function ruleLabels(): Record<string, string> {
  return {
    target_hit: 'цена достигла вашей цели',
    drop_pct: 'заметное падение цены',
    low_percentile: 'редко низкая цена (исторический минимум)',
    new_match: 'новое объявление по фильтрам'
  }
}
