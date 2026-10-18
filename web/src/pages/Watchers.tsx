import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, type Watcher, type HistoryResp } from '../api'
import {
  Card,
  KindBadge,
  LevelChip,
  ScoreBar,
  Sparkline,
  Modal,
  Field,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  RefreshButton,
  Spinner,
  StaleBanner,
  errorText,
  useResource,
  useToast
} from '../ui'
import { confirmAsk, haptic } from '../tg'

type Toast = (t: string, bad?: boolean) => void
const isScan = (w: Watcher) => w.kind === 'krisha_zone' || w.kind === 'kaspi_category'
const digits = (s: string): number | null => (s.replace(/\D/g, '') ? Number(s.replace(/\D/g, '')) : null)
const INTERVALS = [15, 30, 60, 120, 360, 720, 1440]
const intervalLabel = (m: number) => (m < 60 ? `${m} мин` : m < 1440 ? `${m / 60} ч` : 'раз в сутки')

function WatcherCard({ w, onChanged, onEdit, toast }: { w: Watcher; onChanged: () => void; onEdit: () => void; toast: Toast }) {
  const [hist, setHist] = useState<HistoryResp | null>(null)
  const [busy, setBusy] = useState<'run' | 'toggle' | 'del' | null>(null)

  useEffect(() => {
    api.history(w.id, 7).then(setHist).catch(() => setHist(null))
  }, [w.id, w.last_run_at])

  const act = async (kind: 'run' | 'toggle' | 'del', fn: () => Promise<string | null>) => {
    setBusy(kind)
    try {
      const msg = await fn()
      if (msg) toast(msg)
      haptic.ok()
      onChanged()
    } catch (e) {
      haptic.bad()
      toast(errorText(e), true)
    } finally {
      setBusy(null)
    }
  }

  const run = () =>
    act('run', async () => {
      const r = await api.runWatcher(w.id)
      return `#${w.id}: предложений ${r.offers}, лучшая ${fmtMoney(r.bestPrice)}, алертов ${r.alerts}`
    })
  const toggle = () =>
    act('toggle', async () => {
      await api.patchWatcher(w.id, { active: !w.active })
      return w.active ? 'Пауза ⏸' : 'Возобновлено ▶'
    })
  const del = async () => {
    if (!(await confirmAsk(`Удалить «${w.title}»?`))) return
    await act('del', async () => {
      await api.deleteWatcher(w.id)
      return 'Удалено 🗑'
    })
  }

  const delta =
    w.last_price != null && w.prev_price != null && w.prev_price > w.last_price
      ? `−${Math.round(((w.prev_price - w.last_price) / w.prev_price) * 100)}%`
      : null
  const reached = w.target_price != null && w.last_price != null && w.last_price <= w.target_price

  return (
    <Card className={`flex flex-col gap-3 ${w.active ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <KindBadge kind={w.kind} />
        {w.active ? <LevelChip level={w.last_level} score={w.last_score} /> : <span className="chip bg-white/5 text-white/40">⏸ пауза</span>}
      </div>

      <a href={w.best_url || w.url || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:text-cy">
        <span className="text-white/35">#{w.id}</span> {w.title}
      </a>
      {w.best_title && w.best_title !== w.title && <p className="-mt-2 line-clamp-1 text-xs text-white/40">{w.best_title}</p>}

      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-bold">{w.last_price != null ? fmtMoney(w.last_price) : <span className="text-base font-normal text-white/35">ещё не проверялось</span>}</div>
        {delta && <span className="rounded-lg bg-ok/10 px-2 py-0.5 text-sm font-semibold text-ok">{delta}</span>}
        {hist?.trend === 'down' && !delta && <span className="text-xs text-ok">📉 тренд вниз</span>}
        {hist?.trend === 'up' && <span className="text-xs text-hot">📈 тренд вверх</span>}
      </div>

      {(w.target_price != null || w.drop_pct != null || hist?.min != null) && (
        <div className="space-y-1 text-xs text-white/40">
          {w.target_price != null && (
            <div className="flex justify-between">
              <span>🎯 цель</span>
              <span className={reached ? 'text-ok' : ''}>
                {fmtMoney(w.target_price)}
                {reached ? ' ✅' : ''}
              </span>
            </div>
          )}
          {w.drop_pct != null && (
            <div className="flex justify-between">
              <span>📉 алерт при падении</span>
              <span>≥ {w.drop_pct}%</span>
            </div>
          )}
          {hist?.min != null && (
            <div className="flex justify-between">
              <span>минимум за 7 дней</span>
              <span>{fmtMoney(hist.min)}</span>
            </div>
          )}
        </div>
      )}

      <Sparkline points={hist?.series.map((p) => p.p) ?? []} />
      <ScoreBar score={w.last_score} />

      {w.last_error && <p className="rounded-lg bg-warm/10 px-2.5 py-1.5 text-xs text-warm">⚠️ {w.last_error}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={run} disabled={busy != null} title="Проверить сейчас">
          {busy === 'run' ? <Spinner className="!h-3 !w-3" /> : '↻'} {busy === 'run' ? 'Проверяю…' : 'Проверить'}
        </button>
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={onEdit} disabled={busy != null} title="Цель и интервал">
          ✏️
        </button>
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={toggle} disabled={busy != null} title={w.active ? 'Пауза' : 'Возобновить'}>
          {busy === 'toggle' ? <Spinner className="!h-3 !w-3" /> : w.active ? '⏸' : '▶'}
        </button>
        <button className="btn-danger !px-2.5 !py-1.5" onClick={del} disabled={busy != null} title="Удалить">
          {busy === 'del' ? <Spinner className="!h-3 !w-3" /> : '🗑'}
        </button>
        <span className="ml-auto text-white/25" title="Последняя проверка · интервал">
          каждые {intervalLabel(w.interval_min)}
        </span>
      </div>
    </Card>
  )
}

type Mode = 'link' | 'flights'

function WatcherForm({ editing, onClose, onSaved, toast }: { editing: Watcher | null; onClose: () => void; onSaved: () => void; toast: Toast }) {
  const [mode, setMode] = useState<Mode>(editing?.kind === 'flights' ? 'flights' : 'link')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<{ kind: string; hint?: string } | null>(null)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [target, setTarget] = useState(editing?.target_price != null ? String(editing.target_price) : '')
  const [drop, setDrop] = useState(editing?.drop_pct != null ? String(editing.drop_pct) : '')
  const [intervalMin, setIntervalMin] = useState(editing?.interval_min ?? 30)
  const [fl, setFl] = useState({ origin: 'ALA', destination: 'NQZ', depart: '', ret: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (editing || mode !== 'link' || !url.trim()) return void setKind(null)
    const t = setTimeout(() => {
      api
        .detect(url.trim())
        .then((d) => setKind(d.ok && d.kind ? { kind: d.kind, hint: d.hint } : null))
        .catch(() => setKind(null))
    }, 400)
    return () => clearTimeout(t)
  }, [url, mode, editing])

  const iata = (s: string) => /^[A-Za-z]{3}$/.test(s)
  const canSubmit = editing ? true : mode === 'link' ? url.trim() !== '' : iata(fl.origin) && iata(fl.destination)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const common = {
      target_price: digits(target),
      drop_pct: drop.trim() ? Number(drop.replace(',', '.')) : null,
      interval_min: intervalMin
    }
    try {
      if (editing) {
        await api.patchWatcher(editing.id, { ...common, title: title.trim() || editing.title })
        toast('Сохранено ✅')
      } else if (mode === 'link') {
        await api.createWatcher({ ...common, url: url.trim(), title: title.trim() || undefined, run_now: true })
        toast('Наблюдение создано ✅ Первая проверка уже идёт')
      } else {
        const route = `${fl.origin.toUpperCase()}→${fl.destination.toUpperCase()}`
        await api.createWatcher({
          ...common,
          kind: 'flights',
          url: '',
          title: title.trim() || `✈️ ${route}${fl.depart ? ` ${fl.depart}` : ''}${fl.ret ? ` – ${fl.ret}` : ''}`,
          params: {
            origin: fl.origin.toUpperCase(),
            destination: fl.destination.toUpperCase(),
            one_way: !fl.ret,
            ...(fl.depart ? { depart_date: fl.depart } : {}),
            ...(fl.ret ? { return_date: fl.ret } : {})
          },
          run_now: true
        })
        toast('✈️ Слежу за билетами')
      }
      haptic.ok()
      onClose()
      onSaved()
    } catch (e2) {
      haptic.bad()
      setErr(errorText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {!editing && (
        <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
          {(
            [
              ['link', '🔗 Ссылка'],
              ['flights', '✈️ Авиабилеты']
            ] as Array<[Mode, string]>
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${mode === v ? 'bg-gradient-to-r from-vio/60 to-cy/40 text-white' : 'text-white/50 hover:text-white'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {!editing && mode === 'link' && (
        <>
          <Field label="Ссылка (Kaspi / OLX / Krisha)">
            <input className="input" autoFocus inputMode="url" placeholder="https://kaspi.kz/shop/p/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          {url.trim() !== '' && (
            <div className="-mt-1 mb-3 text-xs text-white/50">
              {kind ? (
                <>
                  <KindBadge kind={kind.kind} /> <span className="text-white/35">{kind.hint}</span>
                </>
              ) : (
                <span className="text-warm">Источник не распознан — поддерживаются kaspi.kz/p/…, olx.kz/…/q-запрос/, krisha.kz</span>
              )}
            </div>
          )}
        </>
      )}

      {!editing && mode === 'flights' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Откуда (IATA)">
              <input className="input uppercase" maxLength={3} value={fl.origin} onChange={(e) => setFl({ ...fl, origin: e.target.value })} placeholder="ALA" />
            </Field>
            <Field label="Куда (IATA)">
              <input className="input uppercase" maxLength={3} value={fl.destination} onChange={(e) => setFl({ ...fl, destination: e.target.value })} placeholder="NQZ" />
            </Field>
            <Field label="Туда">
              <input className="input" type="date" value={fl.depart} onChange={(e) => setFl({ ...fl, depart: e.target.value })} />
            </Field>
            <Field label="Обратно (необязательно)">
              <input className="input" type="date" value={fl.ret} onChange={(e) => setFl({ ...fl, ret: e.target.value })} />
            </Field>
          </div>
          <p className="-mt-1 mb-3 text-[11px] text-white/35">Нужен TRAVELPAYOUTS_TOKEN в .env. Без даты — ищем лучшие цены на ближайшие даты.</p>
        </>
      )}

      <Field label="Название (необязательно)">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="iPhone 15 для жены" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Целевая цена, ₸" hint="алерт, когда цена ≤ цели">
          <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="199 990" />
        </Field>
        <Field label="Падение на, %" hint="алерт при снижении">
          <input className="input" inputMode="decimal" value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="10" />
        </Field>
      </div>
      <Field label="Проверять">
        <select className="input" value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))}>
          {INTERVALS.map((m) => (
            <option key={m} value={m}>
              каждые {intervalLabel(m)}
            </option>
          ))}
        </select>
      </Field>

      {err && <p className="mb-3 rounded-lg bg-hot/10 px-3 py-2 text-xs text-hot">{err}</p>}
      <button className="btn-primary w-full" type="submit" disabled={!canSubmit || busy}>
        {busy && <Spinner />} {busy ? 'Сохраняю…' : editing ? 'Сохранить' : 'Начать слежку 🔍'}
      </button>
      {!editing && <p className="mt-2 text-center text-[11px] text-white/30">Первая проверка запустится сразу после создания</p>}
    </form>
  )
}

type Filter = 'all' | 'active' | 'paused' | 'hot' | 'error'

export default function Watchers() {
  const res = useResource(async () => (await api.watchers()).filter((w) => !isScan(w)), [], { refreshMs: 45_000 })
  const [modal, setModal] = useState<{ editing: Watcher | null } | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const { show, node } = useToast()

  const rows = res.data ?? []
  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.active).length,
      paused: rows.filter((r) => !r.active).length,
      hot: rows.filter((r) => r.active && r.last_level === 'hot').length,
      error: rows.filter((r) => r.last_error).length
    }),
    [rows]
  )
  const filtered = rows.filter((r) => {
    if (filter === 'active' && !r.active) return false
    if (filter === 'paused' && r.active) return false
    if (filter === 'hot' && !(r.active && r.last_level === 'hot')) return false
    if (filter === 'error' && !r.last_error) return false
    const needle = q.trim().toLowerCase()
    return !needle || r.title.toLowerCase().includes(needle) || (r.best_title ?? '').toLowerCase().includes(needle)
  })

  const FILTERS: Array<[Filter, string]> = [
    ['all', 'Все'],
    ['active', '▶ Активные'],
    ['paused', '⏸ На паузе'],
    ['hot', '🔥 Горячие'],
    ['error', '⚠️ С ошибкой']
  ]

  return (
    <div className="space-y-5">
      {node}
      <PageHeader title="👀 Наблюдения" sub="Товары и выдачи, за ценой которых следит CheapKZ">
        <RefreshButton res={res} />
        <button className="btn-primary" onClick={() => setModal({ editing: null })}>
          ＋ Добавить
        </button>
      </PageHeader>

      {!res.data ? (
        res.error ? <ErrorState error={res.error} onRetry={res.reload} retrying={res.loading} /> : <PageSkeleton cards={6} />
      ) : (
        <>
          {res.error != null && <StaleBanner error={res.error} onRetry={res.reload} />}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.filter(([v]) => v === 'all' || counts[v] > 0).map(([v, t]) => (
                <button key={v} onClick={() => setFilter(v)} className={`btn !px-3 !py-1.5 text-xs ${filter === v ? 'btn-primary' : 'btn-ghost'}`}>
                  {t} <span className="opacity-60">{counts[v]}</span>
                </button>
              ))}
              <input className="input ml-auto sm:max-w-[220px]" placeholder="🔍 поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              icon="🛒"
              text="Нет наблюдений. Добавь ссылку с Kaspi, OLX или Krisha — и движок начнёт охотиться за ценой."
              action={
                <button className="btn-primary" onClick={() => setModal({ editing: null })}>
                  ＋ Добавить первое
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState icon="🔍" text="Ничего не нашлось по этому фильтру." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((w) => (
                <WatcherCard key={w.id} w={w} onChanged={res.reload} onEdit={() => setModal({ editing: w })} toast={show} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={modal != null} onClose={() => setModal(null)} title={modal?.editing ? `✏️ #${modal.editing.id}` : 'Новое наблюдение'}>
        {modal && <WatcherForm key={modal.editing?.id ?? 'new'} editing={modal.editing} onClose={() => setModal(null)} onSaved={res.reload} toast={show} />}
      </Modal>
    </div>
  )
}
