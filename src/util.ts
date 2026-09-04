export const nowIso = (): string => new Date().toISOString()

export function randInt(a: number, b: number): number {
  return Math.floor(a + Math.random() * (b - a + 1))
}

export function jitterFactor(lo = 0.85, hi = 1.15): number {
  return lo + Math.random() * (hi - lo)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}

const CURRENCY_SYMBOL: Record<string, string> = {
  KZT: '₸',
  RUB: '₽',
  USD: '$',
  EUR: '€',
  UAH: '₴'
}

/** 199990 -> «199 990 ₸» */
export function money(n: number | null | undefined, cur = 'KZT'): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '−' : ''
  const int = Math.round(Math.abs(n)).toString()
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')
  const sym = CURRENCY_SYMBOL[cur.toUpperCase()] ?? cur
  return `${sign}${grouped}\u2009${sym}`
}

/** «200 000 тг», «от 150 000» -> число */
export function numLoose(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  if (typeof s !== 'string') return null
  const m = s.replace(/\u00a0|\u2009|\s/g, '').match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const v = Number(m[0].replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

export function deltaPct(prev: number, next: number): number {
  if (!prev || prev <= 0) return 0
  return ((prev - next) / prev) * 100
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function hashStr(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Экранирование для HTML-текста И для значений атрибутов (кавычки тоже). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SECRET_QS_KEYS = /^(token|api_?key|apikey|access_token|auth|secret|password|signature)$/i

/**
 * Убирает секреты из строк, которые попадают в логи, ошибки и БД:
 * значения чувствительных query-параметров и пароли в URL прокси.
 */
export function redact(s: string): string {
  return s
    .replace(/([?&])([A-Za-z_][\w-]*)=([^&\s'"]+)/g, (full, sep: string, key: string, _v: string) =>
      SECRET_QS_KEYS.test(key) ? `${sep}${key}=***` : full
    )
    .replace(/:\/\/[^/@\s]*@/g, '://***@')
}

export function chunkText(s: string, size = 3800): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out.length ? out : ['']
}

/** Текущее время в заданной TZ как «HH:MM» и час отдельно */
export function tzClock(tz: string): { hhmm: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const hhmm = fmt.format(new Date())
  const hour = Number(hhmm.slice(0, 2))
  return { hhmm, hour }
}

export function inQuietRange(hhmm: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  const t = hhmm.split(':').map(Number)
  const f = from.split(':').map(Number)
  const tt = to.split(':').map(Number)
  const mins = t[0] * 60 + t[1]
  const a = f[0] * 60 + f[1]
  const b = tt[0] * 60 + tt[1]
  if (Number.isNaN(mins) || Number.isNaN(a) || Number.isNaN(b)) return false
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b
}

export function timeAgoRu(iso: string | null | undefined): string {
  if (!iso) return 'никогда'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  return `${d} дн назад`
}

/** Линейная регрессия по индексам точек -> наклон */
export function slope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const mx = (n - 1) / 2
  const my = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (values[i] - my)
    den += (i - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}
