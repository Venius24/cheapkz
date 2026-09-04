import { useEffect, useRef, useState, type ReactNode } from 'react'

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

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="chip border border-white/10 bg-white/5 text-white/60">
      {KIND_ICON[kind] ?? '•'} {kind}
    </span>
  )
}

export function LevelChip({ level, score }: { level: string | null; score?: number | null }) {
  if (!level) return <span className="chip bg-white/5 text-white/40">нет данных</span>
  const map: Record<string, { cls: string; icon: string; text: string }> = {
    hot: { cls: 'bg-hot/15 text-hot border border-hot/30', icon: '🔥', text: 'ЛОВИ СЕЙЧАС' },
    warm: { cls: 'bg-warm/15 text-warm border border-warm/30', icon: '🌤', text: 'хороший момент' },
    cool: { cls: 'bg-cool/15 text-cool border border-cool/30', icon: '❄️', text: 'спокойно' }
  }
  const m = map[level] ?? map.cool
  return (
    <span className={`chip ${m.cls} ${level === 'hot' ? 'animate-pulseHot' : ''}`}>
      {m.icon} {m.text}{score != null ? ` · ${score}` : ''}
    </span>
  )
}

export function ScoreBar({ score }: { score: number | null }) {
  const v = Math.max(0, Math.min(100, score ?? 0))
  const color = v >= 65 ? 'from-hot to-orange-400' : v >= 40 ? 'from-warm to-amber-300' : 'from-cool to-vio'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`} style={{ width: `${v}%` }} />
    </div>
  )
}

export function Sparkline({ points, w = 220, h = 56 }: { points: number[]; w?: number; h?: number }) {
  if (points.length < 2) {
    return <div className="flex h-14 items-center justify-center text-xs text-white/25">мало данных</div>
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
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${down ? 'd' : 'u'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${down ? 'd' : 'u'})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3.2" fill={stroke}>
        <animate attributeName="r" values="3.2;5;3.2" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 max-h-[90vh] w-full max-w-lg overflow-auto p-6 shadow-glow">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <span className="label">{label}</span>
      {children}
    </div>
  )
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-5xl opacity-60">{icon}</div>
      <p className="max-w-sm text-sm text-white/40">{text}</p>
    </div>
  )
}

let toastId = 0
export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; bad?: boolean }>>([])
  const show = (text: string, bad = false) => {
    const id = ++toastId
    setToasts((t) => [...t, { id, text, bad }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }
  const node = (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`glass px-4 py-3 text-sm shadow-glow ${t.bad ? 'border-hot/40 text-hot' : 'border-ok/40'}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
  return { show, node }
}

export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [ms])
}
