import { useEffect, useMemo, useState } from 'react'
import {
  api,
  detector,
  fmtMoney,
  type Anomaly,
  type CatalogCity,
  type DetectorCatalog,
  type Scan,
  type ZoneStat
} from '../api'
import { Card, EmptyState, useInterval, useToast } from '../ui'
import DistrictMap from '../components/DistrictMap'

type Source = 'krisha' | 'kaspi'
type Toast = (t: string, bad?: boolean) => void

const INTERVALS = [15, 30, 60, 120, 360, 720]
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === v ? 'bg-gradient-to-r from-vio/60 to-cy/40 text-white shadow-glow' : 'text-white/50 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Slider({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label !mb-0">{label}</span>
        <span className="text-sm font-bold text-cy">{value}%</span>
      </div>
      <input className="slider" type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="mt-0.5 text-[11px] text-white/35">{hint}</p>}
    </div>
  )
}

function IntervalSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {INTERVALS.map((m) => (
        <option key={m} value={m}>
          каждые {m < 60 ? `${m} мин` : `${m / 60} ч`}
        </option>
      ))}
    </select>
  )
}

// ---------- Krisha: карта районов ----------

interface KrishaDraft {
  id: number | null
  city: string
  deal: 'arenda' | 'prodazha'
  districts: Set<string>
  rooms: Set<number>
  drop_pct: number
  below_pct: number
  pages: number
  interval_min: number
}

const emptyKrisha = (city: string): KrishaDraft => ({
  id: null,
  city,
  deal: 'arenda',
  districts: new Set(),
  rooms: new Set(),
  drop_pct: 7,
  below_pct: 25,
  pages: 2,
  interval_min: 60
})

function krishaFromScan(s: Scan): KrishaDraft {
  const p = s.params
  return {
    id: s.id,
    city: String(p.city ?? 'almaty'),
    deal: p.deal === 'prodazha' ? 'prodazha' : 'arenda',
    districts: new Set(arr(p.districts)),
    rooms: new Set(arr(p.rooms).map(Number)),
    drop_pct: Number(p.drop_pct ?? 7),
    below_pct: Number(p.below_pct ?? 25),
    pages: Number(p.pages ?? 2),
    interval_min: s.interval_min
  }
}

function KrishaEditor({
  catalog,
  scans,
  draft,
  setDraft,
  onSaved,
  toast
}: {
  catalog: DetectorCatalog
  scans: Scan[]
  draft: KrishaDraft
  setDraft: (d: KrishaDraft) => void
  onSaved: () => void
  toast: Toast
}) {
  const [stats, setStats] = useState<Record<string, ZoneStat>>({})
  const [busy, setBusy] = useState(false)
  const city = catalog.cities.find((c) => c.id === draft.city) as CatalogCity

  const loadStats = () => {
    detector.zones(draft.deal).then((r) => setStats(r.zones)).catch(() => {})
  }
  useEffect(loadStats, [draft.deal])
  useInterval(loadStats, 60_000)

  const watched = useMemo(() => {
    const s = new Set<string>()
    for (const sc of scans) {
      if (sc.kind !== 'krisha_zone' || !sc.active || sc.id === draft.id || sc.params.deal !== draft.deal) continue
      for (const a of arr(sc.params.districts)) s.add(a)
    }
    return s
  }, [scans, draft.id, draft.deal])

  const patch = (p: Partial<KrishaDraft>) => setDraft({ ...draft, ...p })
  const toggle = (alias: string) => {
    const next = new Set(draft.districts)
    if (next.has(alias)) next.delete(alias)
    else next.add(alias)
    patch({ districts: next })
  }
  const toggleRoom = (r: number) => {
    const next = new Set(draft.rooms)
    if (next.has(r)) next.delete(r)
    else next.add(r)
    patch({ rooms: next })
  }

  const save = async () => {
    setBusy(true)
    const params = {
      city: draft.city,
      deal: draft.deal,
      districts: [...draft.districts],
      rooms: [...draft.rooms],
      drop_pct: draft.drop_pct,
      below_pct: draft.below_pct,
      pages: draft.pages
    }
    try {
      if (draft.id) await detector.updateScan(draft.id, { params, interval_min: draft.interval_min })
      else await detector.createScan({ kind: 'krisha_zone', params, interval_min: draft.interval_min })
      toast(draft.id ? 'Скан обновлён' : '🛰 Детектор запущен — первый проход уже идёт')
      setDraft(emptyKrisha(draft.city))
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ошибка', true)
    } finally {
      setBusy(false)
    }
  }

  const unitLabel = draft.deal === 'arenda' ? '/м² в мес' : '/м²'
  const selectedList = city.districts.filter((d) => draft.districts.has(d.alias))
  const requests = draft.districts.size * draft.pages

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {catalog.cities.map((c) => (
            <button
              key={c.id}
              onClick={() => setDraft({ ...draft, city: c.id, districts: new Set() })}
              className={`btn !px-3 !py-1.5 text-xs ${draft.city === c.id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {c.name}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => patch({ districts: new Set(city.districts.map((d) => d.alias)) })}>
              Выбрать все
            </button>
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => patch({ districts: new Set() })} disabled={!draft.districts.size}>
              Сбросить
            </button>
          </div>
        </div>
        <div className="h-[520px]">
          <DistrictMap city={city} selected={draft.districts} watched={watched} stats={stats} unitLabel={unitLabel} onToggle={toggle} />
        </div>
      </div>

      <Card className="flex flex-col gap-4 !animate-none">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{draft.id ? `✏️ Скан #${draft.id}` : '🛰 Новый скан районов'}</h3>
          {draft.id && (
            <button className="text-xs text-white/40 hover:text-white" onClick={() => setDraft(emptyKrisha(draft.city))}>
              отменить
            </button>
          )}
        </div>

        <Segmented
          value={draft.deal}
          options={[
            ['arenda', '🔑 Аренда'],
            ['prodazha', '🏷 Продажа']
          ]}
          onChange={(deal) => patch({ deal })}
        />

        <div>
          <span className="label">Районы · {draft.districts.size || 'кликните на карте'}</span>
          <div className="flex min-h-[32px] flex-wrap gap-1.5">
            {selectedList.length ? (
              selectedList.map((d) => (
                <button key={d.alias} onClick={() => toggle(d.alias)} className="chip border border-cy/40 bg-cy/10 text-cy hover:bg-cy/20">
                  {d.name.replace(' р-н', '')} ✕
                </button>
              ))
            ) : (
              <span className="text-xs text-white/30">Наведите на район — увидите медиану цены. Клик — выбрать.</span>
            )}
          </div>
        </div>

        <div>
          <span className="label">Комнат (пусто — любые)</span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((r) => (
              <button
                key={r}
                onClick={() => toggleRoom(r)}
                className={`h-9 w-11 rounded-xl border text-sm font-semibold transition ${
                  draft.rooms.has(r) ? 'border-vio/60 bg-vio/25 text-white' : 'border-white/10 bg-white/5 text-white/50 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Ниже медианы района на"
          value={draft.below_pct}
          min={5}
          max={60}
          onChange={(below_pct) => patch({ below_pct })}
          hint="Цена за м² против квартир той же комнатности и похожей площади (±35%) в районе"
        />
        <Slider
          label="Снижение цены объявления на"
          value={draft.drop_pct}
          min={3}
          max={30}
          onChange={(drop_pct) => patch({ drop_pct })}
          hint="Хозяин сбросил цену относительно её обычного уровня"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="label">Частота</span>
            <IntervalSelect value={draft.interval_min} onChange={(interval_min) => patch({ interval_min })} />
          </div>
          <div>
            <span className="label">Глубина</span>
            <select className="input" value={draft.pages} onChange={(e) => patch({ pages: Number(e.target.value) })}>
              <option value={1}>1 стр. (~20)</option>
              <option value={2}>2 стр. (~40)</option>
              <option value={3}>3 стр. (~60)</option>
            </select>
          </div>
        </div>

        <button className="btn-primary w-full" disabled={busy || !draft.districts.size} onClick={save}>
          {busy ? 'Сохраняю…' : draft.id ? 'Сохранить изменения' : `Запустить детектор${draft.districts.size ? ` · ${draft.districts.size} р-н.` : ''}`}
        </button>
        {requests > 0 && <p className="-mt-2 text-center text-[11px] text-white/30">≈ {requests} запросов к Krisha за проход — с паузами, без спешки</p>}
      </Card>
    </div>
  )
}

// ---------- Kaspi: категории ----------

interface KaspiDraft {
  id: number | null
  city: string
  mode: 'selected' | 'broad'
  categories: Set<string>
  drop_pct: number
  min_price: number
  interval_min: number
}

const emptyKaspi = (): KaspiDraft => ({
  id: null,
  city: 'almaty',
  mode: 'selected',
  categories: new Set(),
  drop_pct: 8,
  min_price: 5000,
  interval_min: 60
})

function kaspiFromScan(s: Scan): KaspiDraft {
  const p = s.params
  return {
    id: s.id,
    city: String(p.city_id ?? 'almaty'),
    mode: p.mode === 'broad' ? 'broad' : 'selected',
    categories: new Set(arr(p.categories)),
    drop_pct: Number(p.drop_pct ?? 8),
    min_price: Number(p.min_price ?? 5000),
    interval_min: s.interval_min
  }
}

function KaspiEditor({
  catalog,
  draft,
  setDraft,
  onSaved,
  toast
}: {
  catalog: DetectorCatalog
  draft: KaspiDraft
  setDraft: (d: KaspiDraft) => void
  onSaved: () => void
  toast: Toast
}) {
  const [busy, setBusy] = useState(false)
  const groups = useMemo(() => {
    const m = new Map<string, DetectorCatalog['categories']>()
    for (const c of catalog.categories) m.set(c.group, [...(m.get(c.group) ?? []), c])
    return [...m.entries()]
  }, [catalog])
  const patch = (p: Partial<KaspiDraft>) => setDraft({ ...draft, ...p })
  const toggle = (code: string) => {
    const next = new Set(draft.categories)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    patch({ categories: next })
  }
  const broad = draft.mode === 'broad'

  const save = async () => {
    setBusy(true)
    const params = {
      city: draft.city,
      mode: draft.mode,
      categories: [...draft.categories],
      drop_pct: draft.drop_pct,
      min_price: draft.min_price
    }
    try {
      if (draft.id) await detector.updateScan(draft.id, { params, interval_min: draft.interval_min })
      else await detector.createScan({ kind: 'kaspi_category', params, interval_min: draft.interval_min })
      toast(draft.id ? 'Скан обновлён' : '🛰 Детектор Kaspi запущен — первый проход соберёт базовые цены')
      setDraft(emptyKaspi())
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ошибка', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className={`!animate-none transition ${broad ? 'opacity-50' : ''}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Категории · {broad ? 'все' : draft.categories.size || 'не выбраны'}</h3>
          {!broad && (
            <div className="flex gap-2">
              <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => patch({ categories: new Set(catalog.categories.map((c) => c.code)) })}>
                все
              </button>
              <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => patch({ categories: new Set() })}>
                сброс
              </button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          {groups.map(([g, cats]) => (
            <div key={g}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">{g}</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {cats.map((c) => {
                  const on = broad || draft.categories.has(c.code)
                  return (
                    <button
                      key={c.code}
                      disabled={broad}
                      onClick={() => toggle(c.code)}
                      className={`group flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        on
                          ? 'border-cy/50 bg-gradient-to-br from-vio/25 to-cy/15 text-white shadow-glow'
                          : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      <span className="text-lg transition group-hover:scale-110">{c.icon}</span>
                      <span className="line-clamp-2 leading-tight">{c.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex h-fit flex-col gap-4 !animate-none">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{draft.id ? `✏️ Скан #${draft.id}` : '🛰 Новый скан Kaspi'}</h3>
          {draft.id && (
            <button className="text-xs text-white/40 hover:text-white" onClick={() => setDraft(emptyKaspi())}>
              отменить
            </button>
          )}
        </div>
        <Segmented
          value={draft.mode}
          options={[
            ['selected', '🎯 Выбранные'],
            ['broad', '🌐 Резкие по всем']
          ]}
          onChange={(mode) => patch({ mode, drop_pct: mode === 'broad' ? Math.max(draft.drop_pct, 15) : draft.drop_pct })}
        />
        <p className="-mt-2 text-[11px] text-white/35">
          {broad
            ? 'Обходит все популярные категории неглубоко и ловит только резкие провалы цены — «ошибки» продавцов.'
            : 'Глубже сканирует только выбранные категории и ловит даже умеренное снижение.'}
        </p>
        <div>
          <span className="label">Город (цены Kaspi зависят от города)</span>
          <select className="input" value={draft.city} onChange={(e) => patch({ city: e.target.value })}>
            {catalog.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Slider
          label="Падение от средней цены на"
          value={draft.drop_pct}
          min={3}
          max={40}
          onChange={(drop_pct) => patch({ drop_pct })}
          hint="Норма — медиана последних замеров цены этого товара"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="label">Мин. цена, ₸</span>
            <input className="input" type="number" min={0} step={1000} value={draft.min_price} onChange={(e) => patch({ min_price: Number(e.target.value) })} />
          </div>
          <div>
            <span className="label">Частота</span>
            <IntervalSelect value={draft.interval_min} onChange={(interval_min) => patch({ interval_min })} />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy || (!broad && !draft.categories.size)} onClick={save}>
          {busy ? 'Сохраняю…' : draft.id ? 'Сохранить изменения' : 'Запустить детектор'}
        </button>
        <p className="-mt-2 text-center text-[11px] text-white/30">Первый проход запоминает цены, аномалии — со второго</p>
      </Card>
    </div>
  )
}

// ---------- список сканов и лента ----------

function ScanRow({ s, onEdit, onChanged, toast }: { s: Scan; onEdit: () => void; onChanged: () => void; toast: Toast }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = (await api.runWatcher(s.id)) as { offers: number; alerts: number; anomalies?: number }
      toast(`#${s.id}: просмотрено ${r.offers}, аномалий ${r.anomalies ?? 0}`)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ошибка', true)
    } finally {
      setBusy(false)
    }
  }
  const pause = async () => {
    await detector.updateScan(s.id, { active: !s.active })
    onChanged()
  }
  const del = async () => {
    if (!confirm(`Удалить «${s.title}» вместе с его находками?`)) return
    await api.deleteWatcher(s.id)
    onChanged()
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0">
      <span className={`h-2 w-2 shrink-0 rounded-full ${!s.active ? 'bg-white/20' : s.last_error ? 'bg-hot' : 'animate-pulseHot bg-ok'}`} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-medium">{s.title}</div>
        <div className="line-clamp-1 text-xs text-white/35">
          {s.last_error ? <span className="text-hot">⚠️ {s.last_error}</span> : s.summary ?? 'ещё не запускался'} · {s.ago} · каждые {s.interval_min} мин
        </div>
      </div>
      {s.anomalies7d > 0 && <span className="chip border border-hot/30 bg-hot/15 text-hot">🔥 {s.anomalies7d} за 7 дн.</span>}
      <div className="flex gap-1">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={onEdit} title="Изменить">✏️</button>
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={run} disabled={busy} title="Проверить сейчас">{busy ? '…' : '↻'}</button>
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={pause} title={s.active ? 'Пауза' : 'Возобновить'}>{s.active ? '⏸' : '▶'}</button>
        <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={del} title="Удалить">🗑</button>
      </div>
    </div>
  )
}

function AnomalyCard({ a }: { a: Anomaly }) {
  const hot = a.level === 'hot'
  const unit = a.kind === 'market'
  const address = typeof a.meta.address === 'string' ? a.meta.address : null
  return (
    <a
      href={a.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={`glass glass-hover group flex animate-fadeUp gap-3 overflow-hidden p-3 ${hot ? 'border-hot/30' : ''}`}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
        {a.image ? (
          <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-50">{a.source === 'krisha' ? '🏠' : '🛒'}</div>
        )}
        <span className={`absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${hot ? 'bg-hot' : 'bg-warm'}`}>
          −{Math.round(a.pct)}%
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-white/40">
          <span className="line-clamp-1">{a.zone_label}</span>
          <span>·</span>
          <span className="shrink-0">{a.ago}</span>
          {hot && <span className="ml-auto shrink-0 animate-pulseHot text-hot">🔥</span>}
        </div>
        <div className="line-clamp-1 text-sm font-medium group-hover:text-cy">{a.title}</div>
        {address && <div className="line-clamp-1 text-[11px] text-white/35">📍 {address}</div>}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-bold">{fmtMoney(a.price)}</span>
          {unit ? (
            <span className="text-xs text-white/40">
              {fmtMoney(a.value)}/м² · у похожих {fmtMoney(a.ref_value)}/м²
            </span>
          ) : (
            <span className="text-xs text-white/40 line-through">{fmtMoney(a.ref_value)}</span>
          )}
        </div>
        <div className="line-clamp-1 text-[11px] text-white/45">{a.reason}</div>
        {a.suspicious && <div className="mt-1 text-[11px] text-warm">⚠️ подозрительно дёшево — проверьте до звонка</div>}
      </div>
    </a>
  )
}

export default function Detector() {
  const [catalog, setCatalog] = useState<DetectorCatalog | null>(null)
  const [scans, setScans] = useState<Scan[]>([])
  const [feed, setFeed] = useState<Anomaly[] | null>(null)
  const [source, setSource] = useState<Source>('krisha')
  const [feedFilter, setFeedFilter] = useState<'all' | Source>('all')
  const [krisha, setKrisha] = useState<KrishaDraft>(emptyKrisha('almaty'))
  const [kaspi, setKaspi] = useState<KaspiDraft>(emptyKaspi())
  const { show, node } = useToast()

  const loadScans = () => detector.scans().then(setScans).catch(() => {})
  const loadFeed = () =>
    detector
      .anomalies(feedFilter === 'all' ? undefined : feedFilter, 60)
      .then(setFeed)
      .catch(() => setFeed([]))

  useEffect(() => {
    detector.catalog().then(setCatalog).catch((e) => show(e instanceof Error ? e.message : 'ошибка', true))
    void loadScans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void loadFeed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedFilter])
  useInterval(() => {
    void loadScans()
    void loadFeed()
  }, 30_000)

  const refresh = () => {
    void loadScans()
    void loadFeed()
  }
  const edit = (s: Scan) => {
    if (s.kind === 'krisha_zone') {
      setSource('krisha')
      setKrisha(krishaFromScan(s))
    } else {
      setSource('kaspi')
      setKaspi(kaspiFromScan(s))
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!catalog) return <div className="py-20 text-center text-white/30">Загрузка…</div>

  const hot24 = (feed ?? []).filter((a) => a.level === 'hot' && Date.now() - new Date(`${a.created_at.replace(' ', 'T')}Z`).getTime() < 86_400_000).length
  const ownScans = scans.filter((s) => (source === 'krisha' ? s.kind === 'krisha_zone' : s.kind === 'kaspi_category'))

  return (
    <div className="space-y-5">
      {node}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">🛰 Детектор аномалий</h2>
          <p className="text-xs text-white/40">
            Сам обходит выбранные районы и категории и присылает в Telegram то, что внезапно подешевело
            {hot24 ? <span className="text-hot"> · 🔥 {hot24} горячих за сутки</span> : null}
          </p>
        </div>
        <div className="ml-auto">
          <Segmented
            value={source}
            options={[
              ['krisha', '🏠 Районы Krisha'],
              ['kaspi', '🛒 Категории Kaspi']
            ]}
            onChange={setSource}
          />
        </div>
      </div>

      {source === 'krisha' ? (
        <KrishaEditor catalog={catalog} scans={scans} draft={krisha} setDraft={setKrisha} onSaved={refresh} toast={show} />
      ) : (
        <KaspiEditor catalog={catalog} draft={kaspi} setDraft={setKaspi} onSaved={refresh} toast={show} />
      )}

      {ownScans.length > 0 && (
        <Card className="!animate-none !p-0">
          <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-white/35">Активные сканы</div>
          {ownScans.map((s) => (
            <ScanRow key={s.id} s={s} onEdit={() => edit(s)} onChanged={refresh} toast={show} />
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 font-semibold">⚡ Лента находок</h3>
        {(
          [
            ['all', 'Все'],
            ['krisha', '🏠 Krisha'],
            ['kaspi', '🛒 Kaspi']
          ] as Array<['all' | Source, string]>
        ).map(([v, t]) => (
          <button key={v} onClick={() => setFeedFilter(v)} className={`btn !px-3 !py-1.5 text-xs ${feedFilter === v ? 'btn-primary' : 'btn-ghost'}`}>
            {t}
          </button>
        ))}
      </div>
      {feed && feed.length === 0 ? (
        <EmptyState
          icon="🛰"
          text={scans.length ? 'Пока тихо: аномалий не найдено. Детектор продолжает следить.' : 'Выберите районы на карте или категории Kaspi и запустите детектор — находки появятся здесь и в Telegram.'}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {(feed ?? []).map((a) => (
            <AnomalyCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  )
}
