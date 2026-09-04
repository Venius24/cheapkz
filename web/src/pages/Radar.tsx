import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, type Deal } from '../api'
import { Card, KindBadge, LevelChip, ScoreBar, EmptyState, useInterval } from '../ui'

type SortKey = 'score' | 'price' | 'time'

export default function Radar() {
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [level, setLevel] = useState<string>('all')
  const [kind, setKind] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('score')
  const [q, setQ] = useState('')

  const load = () => {
    api.deals(200).then(setDeals).catch(() => setDeals([]))
  }
  useEffect(() => {
    void load()
  }, [])
  useInterval(load, 30_000)

  const kinds = useMemo(() => [...new Set((deals ?? []).map((d) => d.kind))], [deals])

  const rows = useMemo(() => {
    let r = deals ?? []
    if (level !== 'all') r = r.filter((d) => d.level === level)
    if (kind !== 'all') r = r.filter((d) => d.kind === kind)
    if (q.trim()) r = r.filter((d) => d.title.toLowerCase().includes(q.toLowerCase()))
    const ts = (d: Deal): number => (d.checkedAt ? new Date(d.checkedAt).getTime() : 0)
    const cmp: Record<SortKey, (a: Deal, b: Deal) => number> = {
      score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
      price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      time: (a, b) => ts(b) - ts(a)
    }
    return [...r].sort(cmp[sort])
  }, [deals, level, kind, sort, q])

  if (!deals) return <div className="py-20 text-center text-white/30">Загрузка…</div>

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">📡 Радар сделок</h2>

      <div className="flex flex-wrap items-center gap-2">
        {[
          ['all', 'Все'],
          ['hot', '🔥 Лови сейчас'],
          ['warm', '🌤 Хорошие'],
          ['cool', '❄️ Спокойные']
        ].map(([v, t]) => (
          <button
            key={v}
            onClick={() => setLevel(v)}
            className={`btn !px-3 !py-1.5 text-xs ${level === v ? 'btn-primary' : 'btn-ghost'}`}
          >
            {t}
          </button>
        ))}
        <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">все источники</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="score">по hot score</option>
          <option value="price">по цене</option>
          <option value="time">по времени проверки</option>
        </select>
        <input className="input max-w-[220px] ml-auto" placeholder="фильтр…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📡" text="Радар пуст. Добавь наблюдения — и здесь появится лента лучших цен." />
      ) : (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
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
                  <td className="px-4 py-3"><LevelChip level={d.level} /></td>
                  <td className="max-w-[340px] px-2 py-3">
                    <a href={d.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:text-cy">{d.title}</a>
                  </td>
                  <td className="px-2 py-3"><KindBadge kind={d.kind} /></td>
                  <td className="px-2 py-3 text-right whitespace-nowrap">
                    <span className="font-semibold">{fmtMoney(d.price)}</span>
                    {d.prev != null && d.prev > (d.price ?? 0) && (
                      <div className="text-[11px] text-ok line-through">{fmtMoney(d.prev)}</div>
                    )}
                  </td>
                  <td className="px-2 py-3 w-28">
                    <ScoreBar score={d.score} />
                    <div className="mt-1 text-right text-[11px] text-white/40">{d.score ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-white/30 whitespace-nowrap">{d.ago}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
