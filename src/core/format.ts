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
