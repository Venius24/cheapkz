import { useMemo, useState } from 'react'
import { api, fmtMoney, type Deal } from '../api'
import { Card, KindBadge, LevelChip, ScoreBar, EmptyState, ErrorState, PageHeader, PageSkeleton, RefreshButton, StaleBanner, useResource } from '../ui'

type SortKey = 'score' | 'price' | 'time'

const LEVELS: Array<[string, string]> = [
  ['all', 'Все'],
  ['hot', '🔥 Лови сейчас'],
  ['warm', '🌤 Хорошие'],
  ['cool', '❄️ Спокойные']
]

function DealPrice({ d }: { d: Deal }) {
  return (
    <>
      <span className="font-semibold">{fmtMoney(d.price)}</span>
      {d.prev != null && d.prev > (d.price ?? 0) && <div className="text-[11px] text-ok line-through">{fmtMoney(d.prev)}</div>}
    </>
  )
}

export default function Radar() {
  const res = useResource(() => api.deals(200), [], { refreshMs: 30_000 })
  const [level, setLevel] = useState<string>('all')
  const [kind, setKind] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('score')
  const [q, setQ] = useState('')
  const deals = res.data

  const kinds = useMemo(() => [...new Set((deals ?? []).map((d) => d.kind))], [deals])
  const levelCount = useMemo(() => {
    const m: Record<string, number> = { all: deals?.length ?? 0 }
    for (const d of deals ?? []) if (d.level) m[d.level] = (m[d.level] ?? 0) + 1
    return m
  }, [deals])

  const rows = useMemo(() => {
    let r = deals ?? []
    if (level !== 'all') r = r.filter((d) => d.level === level)
    if (kind !== 'all') r = r.filter((d) => d.kind === kind)
    if (q.trim()) r = r.filter((d) => d.title.toLowerCase().includes(q.trim().toLowerCase()))
    const ts = (d: Deal): number => (d.checkedAt ? new Date(d.checkedAt).getTime() : 0)
    const cmp: Record<SortKey, (a: Deal, b: Deal) => number> = {
      score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
      price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      time: (a, b) => ts(b) - ts(a)
    }
    return [...r].sort(cmp[sort])
  }, [deals, level, kind, sort, q])

  return (
    <div className="space-y-5">
      <PageHeader title="📡 Радар сделок" sub="Лучшая текущая цена по каждому наблюдению, отсортированная по hot score">
        <RefreshButton res={res} />
      </PageHeader>

      {!deals ? (
        res.error ? <ErrorState error={res.error} onRetry={res.reload} retrying={res.loading} /> : <PageSkeleton cards={3} />
      ) : (
        <>
          {res.error != null && <StaleBanner error={res.error} onRetry={res.reload} />}
          <div className="flex flex-wrap items-center gap-2">
            {LEVELS.map(([v, t]) => (
              <button key={v} onClick={() => setLevel(v)} className={`btn !px-3 !py-1.5 text-xs ${level === v ? 'btn-primary' : 'btn-ghost'}`}>
                {t} <span className="opacity-60">{levelCount[v] ?? 0}</span>
              </button>
            ))}
            <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Источник">
              <option value="all">все источники</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
              <option value="score">по hot score</option>
              <option value="price">по цене</option>
              <option value="time">по времени проверки</option>
            </select>
            <input className="input sm:ml-auto sm:max-w-[220px]" placeholder="🔍 фильтр…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon="📡" text={deals.length ? 'По этим фильтрам пусто.' : 'Радар пуст. Добавь наблюдения — и здесь появится лента лучших цен.'} />
          ) : (
            <>
              {/* телефон и Telegram — карточки, широкий экран — таблица */}
              <div className="grid gap-3 md:hidden">
                {rows.map((d) => (
                  <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="glass glass-hover flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <KindBadge kind={d.kind} />
                      <LevelChip level={d.level} score={d.score} />
                    </div>
                    <div className="line-clamp-2 text-sm font-medium">{d.title}</div>
                    <div className="flex items-end justify-between">
                      <div>
                        <DealPrice d={d} />
                      </div>
                      <span className="text-xs text-white/30">{d.ago}</span>
                    </div>
                    <ScoreBar score={d.score} />
                  </a>
                ))}
              </div>

              <Card className="hidden overflow-x-auto !p-0 md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/35">
                      <th className="px-4 py-3">Уровень</th>
                      <th className="px-2 py-3">Товар / объект</th>
                      <th className="px-2 py-3">Источник</th>
                      <th className="px-2 py-3 text-right">Цена</th>
                      <th className="px-2 py-3 text-right">Score</th>
                      <th className="px-4 py-3 text-right">Проверено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <LevelChip level={d.level} />
                        </td>
                        <td className="max-w-[340px] px-2 py-3">
                          <a href={d.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:text-cy">
                            {d.title}
                          </a>
                        </td>
                        <td className="px-2 py-3">
                          <KindBadge kind={d.kind} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right">
                          <DealPrice d={d} />
                        </td>
                        <td className="w-28 px-2 py-3">
                          <ScoreBar score={d.score} />
                          <div className="mt-1 text-right text-[11px] text-white/40">{d.score ?? '—'}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-white/30">{d.ago}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
