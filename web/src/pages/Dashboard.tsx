import { api, fmtMoney } from '../api'
import { Card, LevelChip, ScoreBar, KindBadge, EmptyState, ErrorState, PageHeader, PageSkeleton, RefreshButton, StaleBanner, useResource } from '../ui'

function StatCard({ label, value, sub, accent, onClick }: { label: string; value: string; sub?: string; accent?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="glass glass-hover flex animate-fadeUp flex-col gap-1 p-5 text-left">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? ''}`}>{value}</span>
      {sub && <span className="text-xs text-white/35">{sub}</span>}
    </button>
  )
}

const loadAll = async () => {
  const [stats, deals, alerts] = await Promise.all([api.stats(), api.deals(8), api.alerts(12)])
  return { stats, hot: deals.filter((x) => x.level === 'hot'), alerts }
}

export default function Dashboard({ go }: { go: (tab: string) => void }) {
  const res = useResource(loadAll, [], { refreshMs: 30_000 })

  if (!res.data) return res.error ? <ErrorState error={res.error} onRetry={res.reload} retrying={res.loading} /> : <PageSkeleton stats cards={3} />
  const { stats, hot, alerts } = res.data

  return (
    <div className="space-y-6">
      <PageHeader title="📊 Обзор" sub="Сводка за последние 24 часа">
        <RefreshButton res={res} />
      </PageHeader>
      {res.error != null && <StaleBanner error={res.error} onRetry={res.reload} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Наблюдений" value={`${stats.active} / ${stats.watchers}`} sub="активных / всего" onClick={() => go('watchers')} />
        <StatCard label="🔥 Горячих сейчас" value={String(stats.hot)} accent={stats.hot > 0 ? 'text-hot' : ''} sub="лови сейчас" onClick={() => go('radar')} />
        <StatCard label="Алертов за 24ч" value={String(stats.alerts24h)} sub={`горячих: ${stats.hotAlerts24h}`} />
        <StatCard label="Экономия за 24ч" value={fmtMoney(stats.savings24h)} accent="text-ok" sub={`проверок цен: ${stats.offers24h}`} />
      </div>

      {stats.watchers === 0 && (
        <Card className="flex flex-col items-start gap-3 border-vio/30 sm:flex-row sm:items-center">
          <div className="text-3xl">👋</div>
          <div className="flex-1">
            <div className="font-semibold">Начните с первой ссылки</div>
            <p className="text-sm text-white/45">Вставьте товар Kaspi, поиск OLX или выдачу Krisha — CheapKZ будет проверять цену и напишет, когда пора брать.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => go('watchers')}>
              ＋ Добавить наблюдение
            </button>
            <button className="btn-ghost" onClick={() => go('detector')}>
              🛰 Детектор
            </button>
          </div>
        </Card>
      )}

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
                  {d.prev != null && d.prev > (d.price ?? 0) && <span className="text-xs text-ok">было {fmtMoney(d.prev)}</span>}
                </div>
                <div className="mt-2">
                  <ScoreBar score={d.score} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">📜 Последние алерты</h2>
        {alerts.length === 0 ? (
          <EmptyState icon="📭" text="Алертов пока нет. Они появятся, когда цена достигнет цели или резко упадёт." />
        ) : (
          <Card className="overflow-hidden !p-0">
            <ul>
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-3 text-sm last:border-0 hover:bg-white/[0.03]">
                  <span>{a.level === 'hot' ? '🔥' : a.level === 'warm' ? '🌤' : '❄️'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-white/80">{a.watcher_title ?? `#${a.watcher_id}`}</div>
                    <div className="truncate text-xs text-white/35">{a.rule}</div>
                  </div>
                  <div className="text-right">
                    <div className="whitespace-nowrap font-semibold">{fmtMoney(a.price)}</div>
                    {a.delta != null && a.delta > 0 && <div className="text-xs text-ok">−{Math.round(a.delta)}%</div>}
                  </div>
                  <span className="hidden w-20 text-right text-xs text-white/30 sm:block">{a.ago}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}
