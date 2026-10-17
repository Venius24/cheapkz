import { clamp, round2 } from '../util.js'

/**
 * Детектор аномально низких цен. Чистые функции без I/O (см. ADR 0003).
 *
 * Два независимых сигнала:
 *  1. drop   — цена позиции только что упала относительно своей нормы
 *              (медиана последних замеров; при коротком ряде — прошлый замер);
 *  2. market — цена за единицу (₸/м²) заметно ниже медианы сопоставимых
 *              объявлений того же района и комнатности.
 * Медиана и MAD вместо среднего и σ: один выброс (опечатка «1 ₸», элитный
 * пентхаус) не сдвигает норму.
 */

export interface AnomalySettings {
  /** Минимальное падение относительно нормы позиции, % */
  dropPct: number
  /** Минимальное отклонение ниже рынка, %; null — сигнал выключен */
  belowMarketPct: number | null
  /** Минимум сопоставимых объявлений для сравнения с рынком */
  minPeers: number
  /** Отклонение ниже рынка, после которого цена считается подозрительной (ошибка/мошенники), % */
  suspiciousPct: number
}

export const DEFAULT_SETTINGS: AnomalySettings = {
  dropPct: 7,
  belowMarketPct: 25,
  minPeers: 6,
  suspiciousPct: 55
}

export interface AnomalyInput {
  price: number
  /** Прошлые цены этой позиции, от старых к новым (без текущей) */
  history: number[]
  /** Цена за единицу этой позиции (например ₸/м²) */
  unit?: number | null
  /** Цены за единицу сопоставимых позиций (без этой) */
  peers?: number[]
}

export interface Anomaly {
  kind: 'drop' | 'market'
  /** С чем сравнивали: норма позиции или медиана рынка (в тех же единицах, что и value) */
  ref: number
  value: number
  /** Насколько ниже нормы, % */
  pct: number
  score: number
  level: 'hot' | 'warm'
  suspicious: boolean
  reason: string
  /** Сколько точек/объявлений легло в основу нормы */
  basis: number
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median absolute deviation, масштабированное к σ нормального распределения. */
export function mad(xs: number[], med = median(xs)): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)))
}

const pctBelow = (ref: number, v: number): number => (ref > 0 ? ((ref - v) / ref) * 100 : 0)

/** Шкала как у Hot Score: ≥ 65 — hot. Падение вдвое больше порога — уже hot. */
export function anomalyScore(pct: number, threshold: number): number {
  const t = Math.max(1, threshold)
  return Math.round(clamp(40 + (pct - t) * (25 / t), 40, 100))
}

function build(kind: Anomaly['kind'], ref: number, value: number, threshold: number, basis: number, suspiciousPct: number): Anomaly {
  const pct = round2(pctBelow(ref, value))
  const score = anomalyScore(pct, threshold)
  const suspicious = pct >= suspiciousPct
  const reason =
    kind === 'drop'
      ? `−${Math.round(pct)}% от обычной цены${basis >= 3 ? ` (медиана ${basis} замеров)` : ''}`
      : `на ${Math.round(pct)}% дешевле похожих квартир района за м² (${basis} объявл.)`
  return { kind, ref: round2(ref), value, pct, score, level: score >= 65 ? 'hot' : 'warm', suspicious, reason, basis }
}

/** Норма позиции: медиана последних ≤ 10 замеров, а при < 3 замерах — прошлый замер. */
export function ownReference(history: number[]): { ref: number; basis: number } | null {
  const h = history.filter((x) => x > 0)
  if (!h.length) return null
  if (h.length < 3) return { ref: h[h.length - 1], basis: h.length }
  const recent = h.slice(-10)
  return { ref: median(recent), basis: recent.length }
}

export function detectDrop(input: AnomalyInput, s: AnomalySettings = DEFAULT_SETTINGS): Anomaly | null {
  const own = ownReference(input.history)
  if (!own) return null
  const prev = input.history[input.history.length - 1]
  // алерт только на переходе вниз: цена, которая уже держится низко, не повторяется
  if (!(input.price < prev)) return null
  if (pctBelow(own.ref, input.price) < s.dropPct) return null
  return build('drop', own.ref, input.price, s.dropPct, own.basis, Infinity)
}

export function detectBelowMarket(input: AnomalyInput, s: AnomalySettings = DEFAULT_SETTINGS): Anomaly | null {
  if (s.belowMarketPct == null || input.unit == null || input.unit <= 0) return null
  const peers = (input.peers ?? []).filter((x) => x > 0)
  if (peers.length < s.minPeers) return null
  const med = median(peers)
  if (pctBelow(med, input.unit) < s.belowMarketPct) return null
  // при большом разбросе рынка «−20%» ещё не аномалия: требуем ≥ 1.5 MAD-сигмы
  const spread = mad(peers, med)
  if (spread > 0 && (med - input.unit) / spread < 1.5) return null
  return build('market', med, input.unit, s.belowMarketPct, peers.length, s.suspiciousPct)
}

/** Самый сильный из сигналов или null. */
export function detectAnomaly(input: AnomalyInput, s: AnomalySettings = DEFAULT_SETTINGS): Anomaly | null {
  const found = [detectDrop(input, s), detectBelowMarket(input, s)].filter((a): a is Anomaly => a != null)
  if (!found.length) return null
  return found.sort((a, b) => b.score - a.score || b.pct - a.pct)[0]
}

export function settingsOf(params: Record<string, unknown>, kind: string): AnomalySettings {
  const num = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Number(v)
    return v == null || v === '' || !Number.isFinite(n) ? d : clamp(n, lo, hi)
  }
  const broad = params.mode === 'broad'
  return {
    dropPct: num(params.drop_pct, 2, 80, broad ? 15 : DEFAULT_SETTINGS.dropPct),
    belowMarketPct: kind === 'krisha_zone' ? num(params.below_pct, 5, 80, DEFAULT_SETTINGS.belowMarketPct ?? 25) : null,
    minPeers: DEFAULT_SETTINGS.minPeers,
    suspiciousPct: DEFAULT_SETTINGS.suspiciousPct
  }
}
