import { round2 } from '../util.js'

export interface ScoreInput {
  price: number | null
  oldPrice?: number | null
  history: number[]
  isNew?: boolean
}

export interface ScoreResult {
  score: number
  level: 'hot' | 'warm' | 'cool'
  parts: Record<string, number>
  reason: string
}

const W = { vsOld: 0.35, histPos: 0.35, depth: 0.2, fresh: 0.1 }

/** Доля значений истории строго ниже price (0..1) */
export function percentileRank(history: number[], price: number): number {
  if (!history.length) return 1
  const below = history.filter((x) => x < price).length
  return below / history.length
}

/**
 * Hot Score 0–100 — «лови сейчас».
 * Компоненты: скидка от старой цены, положение в собственной истории,
 * глубина относительно максимума, свежесть находки.
 * Отсутствующие компоненты перераспределяют вес пропорционально.
 */
export function hotScore(input: ScoreInput): ScoreResult {
  const parts: Record<string, number> = {}
  let acc = 0
  let wsum = 0
  const { price } = input

  if (price != null && input.oldPrice != null && input.oldPrice > price && input.oldPrice > 0) {
    const v = Math.min(1, (input.oldPrice - price) / input.oldPrice)
    parts.vsOld = round2(v)
    acc += W.vsOld * v
    wsum += W.vsOld
  }

  const h = input.history.filter((x) => x > 0)
  if (price != null && h.length >= 5) {
    const pos = 1 - percentileRank(h, price)
    parts.histPos = round2(pos)
    acc += W.histPos * pos
    wsum += W.histPos

    const mx = Math.max(...h)
    if (mx > 0 && mx >= price) {
      const d = Math.min(1, (mx - price) / mx)
      parts.depth = round2(d)
      acc += W.depth * d
      wsum += W.depth
    }
  }

  if (input.isNew) {
    parts.fresh = 1
    acc += W.fresh
    wsum += W.fresh
  }

  if (wsum === 0) {
    return { score: 40, level: 'cool', parts, reason: 'мало данных для оценки' }
  }

  const score = Math.round((100 * acc) / wsum)
  const level: ScoreResult['level'] = score >= 65 ? 'hot' : score >= 40 ? 'warm' : 'cool'
  return { score, level, parts, reason: buildReason(parts) }
}

function buildReason(parts: Record<string, number>): string {
  const bits: Array<{ label: string; contribution: number }> = []
  if (parts.vsOld != null)
    bits.push({ label: `−${Math.round(parts.vsOld * 100)}% от старой цены`, contribution: parts.vsOld * W.vsOld })
  if (parts.histPos != null)
    bits.push({ label: `дешевле ${Math.round(parts.histPos * 100)}% своей истории`, contribution: parts.histPos * W.histPos })
  if (parts.depth != null)
    bits.push({ label: `на ${Math.round(parts.depth * 100)}% ниже максимума`, contribution: parts.depth * W.depth })
  if (parts.fresh === 1) bits.push({ label: 'новая находка', contribution: W.fresh })
  bits.sort((a, b) => b.contribution - a.contribution)
  return bits.slice(0, 2).map((b) => b.label).join(' · ') || 'оценка недоступна'
}
