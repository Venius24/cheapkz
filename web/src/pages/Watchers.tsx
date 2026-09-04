import { useEffect, useState } from 'react'
import { api, ApiError, fmtMoney, type Watcher, type HistoryResp } from '../api'
import { Card, KindBadge, LevelChip, ScoreBar, Sparkline, Modal, Field, EmptyState, useToast, useInterval } from '../ui'

function WatcherCard({
  w,
  onChanged,
  toast
}: {
  w: Watcher
  onChanged: () => void
  toast: (t: string, bad?: boolean) => void
}) {
  const [hist, setHist] = useState<HistoryResp | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.history(w.id, 7).then(setHist).catch(() => {})
  }, [w.id])

  const run = async () => {
    setBusy(true)
    try {
      const r = await api.runWatcher(w.id)
      toast(`#${w.id}: предложений ${r.offers}, алертов ${r.alerts}`)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ошибка', true)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async () => {
    await api.patchWatcher(w.id, { active: !w.active })
    onChanged()
  }

  const del = async () => {
    if (!confirm(`Удалить «${w.title}»?`)) return
    await api.deleteWatcher(w.id)
    onChanged()
  }

  const delta =
    w.last_price != null && w.prev_price != null && w.prev_price > w.last_price
      ? `−${Math.round(((w.prev_price - w.last_price) / w.prev_price) * 100)}%`
      : null

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <KindBadge kind={w.kind} />
        {w.active ? <LevelChip level={w.last_level} score={w.last_score} /> : <span className="chip bg-white/5 text-white/40">⏸ пауза</span>}
      </div>

      <a href={w.url || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:text-cy">
        #{w.id} {w.title}
      </a>
      {w.best_title && <p className="line-clamp-1 text-xs text-white/40">{w.best_title}</p>}

      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-bold">{fmtMoney(w.last_price)}</div>
        {delta && <span className="rounded-lg bg-ok/10 px-2 py-0.5 text-sm font-semibold text-ok">{delta}</span>}
        {hist?.trend === 'down' && !delta && <span className="text-xs text-ok">📉 тренд вниз</span>}
        {hist?.trend === 'up' && <span className="text-xs text-hot">📈 тренд вверх</span>}
      </div>

      {(w.target_price != null || hist?.min != null) && (
        <div className="space-y-1 text-xs text-white/40">
          {w.target_price != null && (
            <div className="flex justify-between">
              <span>🎯 цель</span>
              <span className={w.last_price != null && w.last_price <= w.target_price ? 'text-ok' : ''}>
                {fmtMoney(w.target_price)}
                {w.last_price != null && w.last_price <= w.target_price ? ' ✅' : ''}
              </span>
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

      {w.last_error && <p className="text-xs text-warm">⚠️ {w.last_error}</p>}

      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={run} disabled={busy}>
          {busy ? '…' : '↻ Проверить'}
        </button>
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={toggle}>{w.active ? '⏸' : '▶'}</button>
        <button className="btn-danger !px-2.5 !py-1.5" onClick={del}>🗑</button>
        <span className="ml-auto self-center text-white/25">{w.interval_min} мин</span>
      </div>
    </Card>
  )
}

function AddModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [intervalMin, setIntervalMin] = useState('30')
  const [busy, setBusy] = useState(false)
  const { show: toast, node } = useToast()

  useEffect(() => {
    if (!url.trim()) return (setKind(null), undefined)
    const t = setTimeout(() => {
      api
        .detect(url.trim())
        .then((d) => setKind(d.ok ? d.kind ?? null : null))
        .catch(() => setKind(null))
    }, 400)
    return () => clearTimeout(t)
  }, [url])

  const submit = async () => {
    setBusy(true)
    try {
      await api.createWatcher({
        url: url.trim(),
        title: title.trim() || undefined,
        target_price: target ? Number(target.replace(/\D/g, '')) : null,
        interval_min: Number(intervalMin),
        run_now: true
      })
      toast('Наблюдение создано ✅')
      onClose()
      onCreated()
      setUrl('')
      setTitle('')
      setTarget('')
    } catch (e) {
      toast(e instanceof ApiError ? 'нет доступа' : e instanceof Error ? e.message : 'ошибка', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новое наблюдение">
      {node}
      <Field label="Ссылка (Kaspi / OLX / Krisha)">
        <input className="input" placeholder="https://kaspi.kz/p/tovar/12345678/" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      {url.trim() !== '' && (
        <div className="mb-3 text-xs text-white/50">
          Тип: {kind ? <span className="chip bg-vio/20 text-vio">{kind}</span> : <span className="text-warm">не распознан — будет universal-адаптер</span>}
        </div>
      )}
      <Field label="Название (необязательно)">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="iPhone 15 для жены" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Целевая цена ₸">
          <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="199990" />
        </Field>
        <Field label="Интервал, мин">
          <input className="input" inputMode="numeric" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} />
        </Field>
      </div>
      <button className="btn-primary w-full" onClick={submit} disabled={!url.trim() || busy}>
        {busy ? 'Создаю…' : 'Начать слежку 🔍'}
      </button>
      <p className="mt-2 text-center text-[11px] text-white/30">Первая проверка запустится сразу после создания</p>
    </Modal>
  )
}

export default function Watchers() {
  const [rows, setRows] = useState<Watcher[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const { show, node } = useToast()

  const load = () => {
    api.watchers().then(setRows).catch(() => setRows([]))
  }
  useEffect(() => {
    void load()
  }, [])
  useInterval(load, 45_000)

  if (!rows) return <div className="py-20 text-center text-white/30">Загрузка…</div>

  const filtered = rows.filter((r) => r.title.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">👀 Наблюдения</h2>
        <input className="input max-w-[220px]" placeholder="поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setAddOpen(true)}>＋ Добавить</button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🛒" text="Нет наблюдений. Добавь ссылку с Kaspi, OLX или Krisha — и движок начнёт охотиться за ценой." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((w) => (
            <WatcherCard key={w.id} w={w} onChanged={load} toast={show} />
          ))}
        </div>
      )}

      <AddModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={load} />
      {node}
    </div>
  )
}
