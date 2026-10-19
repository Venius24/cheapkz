import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { ApiError } from './api'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass glass-hover animate-fadeUp p-5 ${className}`}>{children}</div>
}

export const KIND_ICON: Record<string, string> = {
  kaspi: '🛒',
  olx: '🛍',
  krisha: '🏠',
  flights: '✈️',
  generic: '🌐'
}

const KIND_LABEL: Record<string, string> = {
  kaspi: 'Kaspi',
  olx: 'OLX',
  krisha: 'Krisha',
  flights: 'Билеты',
  generic: 'Сайт'
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="chip border border-white/10 bg-white/5 text-white/60">
      {KIND_ICON[kind] ?? '•'} {KIND_LABEL[kind] ?? kind}
    </span>
  )
}

export function LevelChip({ level, score }: { level: string | null; score?: number | null }) {
  if (!level) return <span className="chip bg-white/5 text-white/40">ждёт проверки</span>
  const map: Record<string, { cls: string; icon: string; text: string }> = {
    hot: { cls: 'bg-hot/15 text-hot border border-hot/30', icon: '🔥', text: 'ЛОВИ СЕЙЧАС' },
    warm: { cls: 'bg-warm/15 text-warm border border-warm/30', icon: '🌤', text: 'хороший момент' },
    cool: { cls: 'bg-cool/15 text-cool border border-cool/30', icon: '❄️', text: 'спокойно' }
  }
  const m = map[level] ?? map.cool
  return (
    <span className={`chip ${m.cls} ${level === 'hot' ? 'animate-pulseHot' : ''}`}>
      {m.icon} {m.text}
      {score != null ? ` · ${score}` : ''}
    </span>
  )
}

export function ScoreBar({ score }: { score: number | null }) {
  const v = Math.max(0, Math.min(100, score ?? 0))
  const color = v >= 65 ? 'from-hot to-orange-400' : v >= 40 ? 'from-warm to-amber-300' : 'from-cool to-vio'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" title={`hot score ${score ?? '—'}/100`}>
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`} style={{ width: `${v}%` }} />
    </div>
  )
}

export function Sparkline({ points, w = 220, h = 56 }: { points: number[]; w?: number; h?: number }) {
  if (points.length < 2) {
    return <div className="flex h-14 items-center justify-center text-xs text-white/25">история появится после пары проверок</div>
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const pad = (max - min) * 0.12 || 1
  const lo = min - pad
  const hi = max + pad
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4
  const y = (p: number) => h - 6 - ((p - lo) / (hi - lo)) * (h - 12)
  const line = points.map((p, i) => `${x(i)},${y(p)}`).join(' ')
  const area = `M4,${h - 4} L${line.replaceAll(' ', ' L')} L${w - 4},${h - 4} Z`
  const down = points[points.length - 1] <= points[0]
  const stroke = down ? '#34d399' : '#f43f5e'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${down ? 'd' : 'u'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${down ? 'd' : 'u'})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3.2" fill={stroke}>
        <animate attributeName="r" values="3.2;5;3.2" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 max-h-[92vh] w-full max-w-lg animate-fadeUp overflow-auto rounded-b-none !bg-panel/95 p-6 shadow-glow sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </label>
  )
}

export function EmptyState({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <div className="text-5xl opacity-60">{icon}</div>
      <p className="max-w-sm text-sm text-white/40">{text}</p>
      {action}
    </div>
  )
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        {sub && <p className="text-xs text-white/40">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// ---------- загрузка, ошибки, скелетоны ----------

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'что-то пошло не так')

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-cy ${className}`} />
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/[0.06] ${className}`} />
}

/** Заглушка страницы на первой загрузке: форма будущего контента вместо «Загрузка…». */
export function PageSkeleton({ cards = 6, stats = false }: { cards?: number; stats?: boolean }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-7 w-48 !rounded-lg" />
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  )
}

export function ErrorState({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const offline = error instanceof ApiError && error.offline
  return (
    <div className="glass mx-auto mt-6 flex max-w-md animate-fadeUp flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="text-4xl">{offline ? '📡' : '⚠️'}</div>
      <h3 className="font-semibold">{offline ? 'Сервер недоступен' : 'Не удалось загрузить данные'}</h3>
      <p className="text-sm text-white/45">
        {offline ? `${errorText(error)}. Проверьте, что CheapKZ запущен, и соединение с сетью.` : errorText(error)}
      </p>
      <button className="btn-primary mt-1" onClick={onRetry} disabled={retrying}>
        {retrying ? <Spinner /> : '↻'} Повторить
      </button>
      <p className="text-[11px] text-white/25">повторим автоматически через несколько секунд</p>
    </div>
  )
}

/** Строка «не обновилось» над уже показанными данными, если упало фоновое обновление. */
export function StaleBanner({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-warm/30 bg-warm/10 px-4 py-2 text-xs text-warm">
      <span>⚠️ Не обновилось: {errorText(error)}. Показаны последние данные.</span>
      <button className="ml-auto shrink-0 font-semibold underline-offset-2 hover:underline" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}

export interface Resource<T> {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => Promise<void>
  /** Оптимистичная правка уже загруженных данных. */
  mutate: (fn: (d: T) => T) => void
  updatedAt: number | null
}

/**
 * Данные страницы: состояние загрузки/ошибки, фоновое обновление и авто-повтор
 * после сбоя (5 → 10 → 30 с) — экран никогда не висит на загрузке молча.
 * Таймаут каждого запроса — в api.request.
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[] = [], opts: { refreshMs?: number } = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [failures, setFailures] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await fetcherRef.current()
      if (my !== seq.current) return
      setData(d)
      setError(null)
      setFailures(0)
      setUpdatedAt(Date.now())
    } catch (e) {
      if (my !== seq.current) return
      setError(e)
      setFailures((n) => n + 1)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // авто-повтор (кроме 401 — тогда приложение само уводит на экран входа)
  useEffect(() => {
    if (!failures || (error instanceof ApiError && error.unauthorized)) return
    const t = setTimeout(() => void reload(), [5_000, 10_000][failures - 1] ?? 30_000)
    return () => clearTimeout(t)
  }, [failures, error, reload])

  useInterval(() => {
    if (!error) void reload()
  }, opts.refreshMs ?? 0)

  const mutate = useCallback((fn: (d: T) => T) => setData((d) => (d == null ? d : fn(d))), [])
  return { data, error, loading, reload, mutate, updatedAt }
}

/** Кнопка ручного обновления с «обновлено N с назад». */
export function RefreshButton({ res }: { res: Pick<Resource<unknown>, 'loading' | 'reload' | 'updatedAt'> }) {
  const [, tick] = useState(0)
  useInterval(() => tick((x) => x + 1), 10_000)
  const ago = res.updatedAt ? Math.round((Date.now() - res.updatedAt) / 1000) : null
  const label = ago == null ? 'обновить' : ago < 10 ? 'только что' : ago < 60 ? `${ago} с назад` : `${Math.floor(ago / 60)} мин назад`
  return (
    <button className="btn-ghost !px-3 !py-1.5 text-xs text-white/50" onClick={() => void res.reload()} disabled={res.loading} title="Обновить">
      {res.loading ? <Spinner className="!h-3 !w-3" /> : '↻'}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crash', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="glass max-w-md space-y-3 p-8 text-center">
          <div className="text-4xl">🧯</div>
          <h3 className="font-semibold">Этот экран сломался</h3>
          <p className="text-sm text-white/45">{this.state.error.message}</p>
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }
}

let toastId = 0
export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; bad?: boolean }>>([])
  const show = useCallback((text: string, bad = false) => {
    const id = ++toastId
    setToasts((t) => [...t, { id, text, bad }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 5000 : 3500)
  }, [])
  const node = (
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end lg:bottom-5">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`glass pointer-events-auto max-w-sm animate-fadeUp !bg-panel/95 px-4 py-3 text-sm shadow-glow ${t.bad ? 'border-hot/40 text-hot' : 'border-ok/40'}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
  return { show, node }
}

/** setInterval, который молчит, пока вкладка скрыта, и догоняет при возвращении. ms ≤ 0 — выключен. */
export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (ms <= 0) return
    let last = Date.now()
    const t = setInterval(() => {
      if (document.hidden) return
      last = Date.now()
      ref.current()
    }, ms)
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= ms) {
        last = Date.now()
        ref.current()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms])
}
