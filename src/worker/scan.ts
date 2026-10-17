import {
  addPoint,
  cacheGet,
  cacheSet,
  insertAlert,
  insertAnomaly,
  pointHistory,
  recentScanOffers,
  updateWatcher,
  upsertOffer,
  type DB,
  type WatcherRow
} from '../db/index.js'
import { tx } from '../db/client.js'
import { detectAnomaly, settingsOf, type Anomaly } from '../core/anomaly.js'
import { buildAnomalyMessage } from '../core/format.js'
import type { Offer } from '../sources/types.js'
import type { ScanItem, ScanMeta } from '../sources/scan.js'
import { escapeHtml, nowIso, safeJson } from '../util.js'

/** Больше алертов за один проход — уже спам; остальное видно в ленте панели. */
export const MAX_ALERTS_PER_RUN = 5
/** Окно «рынка» района: объявления, виденные за последние дни */
export const MARKET_WINDOW_DAYS = 14
const REPEAT_HOURS = 24

export interface ScanResult {
  offers: number
  alerts: number
  bestPrice: number | null
  anomalies: number
}

interface Found {
  item: ScanItem
  anomaly: Anomaly
  prevPrice: number | null
}

function isScanItem(o: Offer): o is ScanItem {
  const m = o.meta as Partial<ScanMeta> | undefined
  return o.price != null && o.price > 0 && typeof m?.zone === 'string'
}

interface Peer {
  unit: number
  area: number | null
}

/** Рыночные группы: group → (external_id → ₸/м² и площадь). Дубли из разных сканов схлопываются. */
function marketGroups(db: DB, kind: string): Map<string, Map<string, Peer>> {
  const groups = new Map<string, Map<string, Peer>>()
  const put = (g: string, id: string, p: Peer): void => {
    let m = groups.get(g)
    if (!m) groups.set(g, (m = new Map()))
    m.set(id, p)
  }
  for (const r of recentScanOffers(db, kind, MARKET_WINDOW_DAYS)) {
    const meta = safeJson<Partial<ScanMeta>>(r.meta_json, {})
    if (!meta.group || !meta.unit || meta.unit <= 0) continue
    const p = { unit: meta.unit, area: meta.area ?? null }
    put(meta.group, r.external_id, p)
    if (meta.market) put(`${meta.market}|*`, r.external_id, p)
  }
  return groups
}

/** Похожая площадь: ±35%. Большие квартиры всегда дешевле за м² — их нельзя мерить по маленьким. */
export const SIMILAR_AREA = 1.35

/**
 * Сопоставимые объявления: сначала та же комнатность и похожая площадь,
 * при нехватке — весь район той же сделки, но тоже похожей площади.
 */
export function peersFor(groups: Map<string, Map<string, Peer>>, item: ScanItem, minPeers: number): number[] {
  const area = item.meta.area
  if (!area || area <= 0) return []
  const similar = (p: Peer): boolean => p.area != null && p.area >= area / SIMILAR_AREA && p.area <= area * SIMILAR_AREA
  const pick = (g: string | null | undefined): number[] => {
    const m = g ? groups.get(g) : undefined
    if (!m) return []
    return [...m.entries()].filter(([id, p]) => id !== item.externalId && similar(p)).map(([, p]) => p.unit)
  }
  const exact = pick(item.meta.group)
  if (exact.length >= minPeers) return exact
  return item.meta.market ? pick(`${item.meta.market}|*`) : exact
}

/**
 * Повтор по той же позиции — не чаще раза в сутки, если цена не ушла
 * ещё ниже: иначе каждый проход слал бы одно и то же.
 */
function repeatAllowed(db: DB, watcherId: number, item: ScanItem): boolean {
  const last = cacheGet(db, `an:${watcherId}:${item.externalId}`)
  if (last == null) return true
  return item.price < Number(last) * 0.97
}

/**
 * Обработка результата скана: история каждой позиции, сравнение с нормой
 * и рынком, запись находок и алертов. Сеть здесь не нужна — функция
 * тестируется на готовом списке позиций.
 */
export function applyScan(db: DB, w: WatcherRow, params: Record<string, unknown>, offers: Offer[]): ScanResult {
  const settings = settingsOf(params, w.kind)
  const items = offers.filter(isScanItem)
  const prevPrices = new Map(
    (db.prepare(`SELECT external_id, price FROM offers WHERE watcher_id=?`).all(w.id) as Array<{
      external_id: string
      price: number | null
    }>).map((r) => [r.external_id, r.price])
  )

  // дешёвая мелочь даёт ложные «аномалии» на копейках — её только храним
  const minPrice = Math.max(0, Number(params.min_price) || 0)
  const candidates: Array<{ item: ScanItem; history: number[]; prevPrice: number | null }> = []
  // сотни upsert-ов в одной транзакции — на порядок быстрее, чем по одному
  tx(db, () => {
    for (const item of items) {
      const known = prevPrices.has(item.externalId)
      const prevPrice = prevPrices.get(item.externalId) ?? null
      // история ДО текущего замера
      let history = known ? pointHistory(db, w.id, 10, item.externalId) : []
      if (!history.length && prevPrice != null) history = [prevPrice]
      upsertOffer(db, {
        watcher_id: w.id,
        external_id: item.externalId,
        title: item.title,
        url: item.url,
        seller: item.seller ?? null,
        price: item.price,
        old_price: item.oldPrice ?? null,
        currency: item.currency ?? 'KZT',
        in_stock: 1,
        meta_json: JSON.stringify(item.meta)
      })
      if (prevPrice !== item.price) addPoint(db, w.id, item.externalId, item.price)
      if (item.price < minPrice) continue
      // оцениваем только новое и подешевевшее: остальное уже оценивали раньше
      if (!known || (prevPrice != null && item.price < prevPrice)) candidates.push({ item, history, prevPrice })
    }
  })

  const groups = settings.belowMarketPct != null ? marketGroups(db, w.kind) : new Map<string, Map<string, Peer>>()
  const found: Found[] = []
  for (const c of candidates) {
    const anomaly = detectAnomaly(
      {
        price: c.item.price,
        history: c.history,
        unit: c.item.meta.unit,
        peers: settings.belowMarketPct != null ? peersFor(groups, c.item, settings.minPeers) : []
      },
      settings
    )
    if (anomaly && repeatAllowed(db, w.id, c.item)) found.push({ item: c.item, anomaly, prevPrice: c.prevPrice })
  }
  found.sort((a, b) => b.anomaly.score - a.anomaly.score || b.anomaly.pct - a.anomaly.pct)

  const source = w.kind === 'krisha_zone' ? 'krisha' : 'kaspi'
  let alerts = 0
  for (const f of found) {
    const { item, anomaly } = f
    const meta = item.meta
    insertAnomaly(db, {
      watcher_id: w.id,
      source,
      kind: anomaly.kind,
      external_id: item.externalId,
      zone: meta.zone,
      zone_label: meta.zoneLabel,
      title: item.title.slice(0, 200),
      url: item.url,
      image: meta.image,
      price: item.price,
      ref_value: anomaly.ref,
      value: anomaly.value,
      pct: anomaly.pct,
      score: anomaly.score,
      level: anomaly.level,
      suspicious: anomaly.suspicious ? 1 : 0,
      reason: anomaly.reason,
      meta_json: JSON.stringify({ ...meta, prevPrice: f.prevPrice, basis: anomaly.basis })
    })
    cacheSet(db, `an:${w.id}:${item.externalId}`, String(item.price), REPEAT_HOURS * 3600_000)
    if (alerts >= MAX_ALERTS_PER_RUN) continue
    insertAlert(db, {
      watcher_id: w.id,
      rule: `anomaly_${anomaly.kind}`,
      level: anomaly.level,
      message: buildAnomalyMessage({
        source,
        title: item.title,
        url: item.url,
        zoneLabel: meta.zoneLabel,
        price: item.price,
        ref: anomaly.ref,
        pct: anomaly.pct,
        kind: anomaly.kind,
        level: anomaly.level,
        suspicious: anomaly.suspicious,
        reason: anomaly.reason,
        unit: meta.unit,
        address: typeof meta.address === 'string' ? meta.address : null,
        prevPrice: f.prevPrice
      }),
      price: item.price,
      delta: anomaly.kind === 'drop' ? anomaly.pct : null
    })
    alerts++
  }
  if (found.length > alerts) {
    insertAlert(db, {
      watcher_id: w.id,
      rule: 'anomaly_more',
      level: 'warm',
      message: `🔎 <b>${escapeHtml(w.title)}</b>: ещё ${found.length - alerts} аномалий — смотрите ленту «Детектор» в веб-панели.`
    })
    alerts++
  }

  const top = found[0]?.anomaly
  updateWatcher(db, w.id, {
    last_error: null,
    last_run_at: nowIso(),
    last_level: top ? top.level : 'cool',
    last_score: top ? top.score : null,
    best_title: `${items.length} позиций · аномалий: ${found.length}`,
    best_url: found[0]?.item.url ?? null
  })
  return { offers: items.length, alerts, bestPrice: null, anomalies: found.length }
}
