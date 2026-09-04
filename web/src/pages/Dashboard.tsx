import { useEffect, useState } from 'react'
import { api, fmtMoney, type Stats, type Deal, type AlertRow } from '../api'
import { Card, LevelChip, ScoreBar, KindBadge, EmptyState, useInterval } from '../ui'

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? ''}`}>{value}</span>
      {sub && <span className="text-xs text-white/35">{sub}</span>}
    </Card>
  )
}

export default function Dashboard({ go }: { go: (tab: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [hot, setHot] = useState<Deal[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])

  const load = () => {
    api.stats().then(setStats).catch(() => {})
    api.deals(8).then((d) => setHot(d.filter((x) => x.level === 'hot'))).catch(() => {})
    api.alerts(12).then(setAlerts).catch(() => {})
  }
  useEffect(load, [])
  useInterval(load, 30_000)

  if (!stats) return <div className="py-20 text-center text-white/30">Загрузка…</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Наблюдений" value={`${stats.active} / ${stats.watchers}`} sub="активных / всего" />
        <StatCard
          label="🔥 Горячих сейчас"
          value={String(stats.hot)}
          accent={stats.hot > 0 ? 'text-hot' : ''}
          sub="лови сейчас"
        />
        <StatCard label="Алертов за 24ч" value={String(stats.alerts24h)} sub={`горячих: ${stats.hotAlerts24h}`} />
        <StatCard
          label="Экономия за 24ч"
          value={fmtMoney(stats.savings24h)}
          accent="text-ok"
          sub={`проверок цен: ${stats.offers24h}`}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">🚨 Лови сейчас</h2>
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => go('radar')}>
            Весь радар →
          </button>
        </div>
        {hot.length === 0 ? (
          <EmptyState icon="🕵️" text="Горячих сделок нет — движок следит и сообщит сразу, как цена станет аномально низкой." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {hot.map((d) => (
              <Card key={d.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <KindBadge kind={d.kind} />
                  <LevelChip level={d.level} score={d.score} />
                </div>
                <a href={d.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:text-cy">
                  {d.title}
                </a>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-xl font-bold">{fmtMoney(d.price)}</span>
                  {d.prev != null && d.prev > (d.price ?? 0) && (
                    <span className="text-xs text-ok">было {fmtMoney(d.prev)}</span>
                  )}
                </div>
                <div className="mt-2"><ScoreBar score={d.score} /></div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">📜 Последние алерты</h2>
        {alerts.length === 0 ? (
          <EmptyState icon="📭" text="Алертов пока нет." />
        ) : (
          <Card className="!p-0 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 w-10">{a.level === 'hot' ? '🔥' : a.level === 'warm' ? '🌤' : '❄️'}</td>
                    <td className="px-2 py-3 text-white/70">{a.watcher_title ?? `#${a.watcher_id}`}</td>
                    <td className="px-2 py-3 hidden sm:table-cell text-white/40">{a.rule}</td>
                    <td className="px-2 py-3 text-right whitespace-nowrap">{fmtMoney(a.price)}</td>
                    {a.delta != null && a.delta > 0 && (
                      <td className="px-2 py-3 text-right text-ok whitespace-nowrap">−{Math.round(a.delta)}%</td>
                    )}
                    <td className="px-4 py-3 text-right text-xs text-white/30 whitespace-nowrap">{a.ago}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}
