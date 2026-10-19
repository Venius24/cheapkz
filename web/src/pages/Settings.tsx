import { useState } from 'react'
import { api, type Me, type SystemInfo } from '../api'
import { Card, Field, ErrorState, PageSkeleton, Spinner, errorText, useResource, useToast } from '../ui'
import { haptic } from '../tg'

type Toast = (t: string, bad?: boolean) => void

function TokenRow({ name, ok, env }: { name: string; ok: boolean; env: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{name}</div>
        <div className="truncate text-xs text-white/35">
          .env → <code className="text-cy/80">{env}</code>
        </div>
      </div>
      <span className={`chip shrink-0 ${ok ? 'bg-ok/15 text-ok' : 'bg-hot/15 text-hot'}`}>{ok ? '✓ настроен' : '✗ не задан'}</span>
    </div>
  )
}

function Row({ k, v, cls = '' }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/50">{k}</span>
      <b className={cls}>{v}</b>
    </div>
  )
}

const MUTE_OPTIONS: Array<[number, string]> = [
  [0, 'не глушить'],
  [60, 'на 1 час'],
  [180, 'на 3 часа'],
  [480, 'на 8 часов'],
  [1440, 'на сутки'],
  [10080, 'на неделю']
]

/** Личные уведомления — то же, что /quiet, /digest и /mute в боте. */
function Notifications({ me, onMe, toast }: { me: Me; onMe: (m: Me) => void; toast: Toast }) {
  const u = me.user
  const [quietOn, setQuietOn] = useState(Boolean(u?.quiet_from))
  const [from, setFrom] = useState(u?.quiet_from ?? '23:00')
  const [to, setTo] = useState(u?.quiet_to ?? '07:00')
  const [digest, setDigest] = useState<string>(u?.digest_hour != null ? String(u.digest_hour) : '')
  const [breakHot, setBreakHot] = useState(u?.break_quiet_on_hot ?? true)
  const [busy, setBusy] = useState(false)
  if (!u) return null

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const m = await api.patchMe({
        quiet_from: quietOn ? from : null,
        quiet_to: quietOn ? to : null,
        digest_hour: digest === '' ? null : Number(digest),
        break_quiet_on_hot: breakHot,
        ...extra
      })
      onMe(m)
      haptic.ok()
      toast('Сохранено ✅')
    } catch (e) {
      haptic.bad()
      toast(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }

  const muted = u.muted_until ? new Date(u.muted_until) : null

  return (
    <Card className="!animate-none space-y-4">
      <div>
        <h3 className="font-semibold">🔔 Уведомления в Telegram</h3>
        <p className="text-xs text-white/40">Алерты приходят в чат с ботом{u.username ? ` @${u.username}` : ''}.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">🔇 Тишина</div>
            <div className="text-xs text-white/40">{muted ? `до ${muted.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : 'выключена'}</div>
          </div>
          <select className="input !w-auto" value="" onChange={(e) => void save({ mute_minutes: Number(e.target.value) })} disabled={busy} aria-label="Тишина">
            <option value="" disabled>
              {muted ? 'изменить…' : 'включить…'}
            </option>
            {MUTE_OPTIONS.map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">🌙 Тихие часы</span>
        <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={quietOn} onChange={(e) => setQuietOn(e.target.checked)} />
      </label>
      {quietOn && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="С">
            <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="До">
            <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <label className="col-span-2 -mt-1 flex items-center gap-2 text-xs text-white/55">
            <input type="checkbox" className="accent-cyan-400" checked={breakHot} onChange={(e) => setBreakHot(e.target.checked)} />
            🔥 горячие алерты всё равно присылать
          </label>
        </div>
      )}

      <Field label={`🌅 Ежедневная сводка (${me.timezone})`}>
        <select className="input" value={digest} onChange={(e) => setDigest(e.target.value)}>
          <option value="">выключена</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              каждый день в {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </Field>

      <button className="btn-primary w-full" onClick={() => void save()} disabled={busy}>
        {busy && <Spinner />} Сохранить
      </button>
    </Card>
  )
}

function AdminSystem({ toast }: { toast: Toast }) {
  const sys = useResource(() => api.system() as Promise<SystemInfo>, [], { refreshMs: 60_000 })
  const settings = useResource(() => api.settings(), [])
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!sys.data) return sys.error ? <ErrorState error={sys.error} onRetry={sys.reload} retrying={sys.loading} /> : <PageSkeleton cards={4} />
  const s = sys.data
  const currentInterval = intervalDraft ?? settings.data?.default_interval_min ?? '30'

  const save = async () => {
    setBusy(true)
    try {
      await api.saveSettings({ default_interval_min: Number(currentInterval) || 30 })
      toast('Настройки сохранены ✅')
      void settings.reload()
    } catch (e) {
      toast(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">🔑 Токены</h2>
        <TokenRow name="Telegram-бот" ok={s.tokens.telegram} env="TELEGRAM_BOT_TOKEN" />
        <TokenRow name="Авиабилеты (Travelpayouts)" ok={s.tokens.travelpayouts} env="TRAVELPAYOUTS_TOKEN" />
        <TokenRow name="Админ-доступ к панели" ok={s.tokens.admin} env="ADMIN_TOKEN" />
        <p className="text-xs text-white/35">
          Токены задаются в файле <code className="text-cy/80">.env</code> рядом с проектом. После правки перезапустите сервис.
        </p>

        <h2 className="pt-4 text-lg font-semibold">⚙️ Общие настройки</h2>
        <Card className="!animate-none">
          <Field label="Интервал проверки по умолчанию, мин" hint="Для новых наблюдений без явного интервала (в том числе из бота)">
            <input className="input" inputMode="numeric" value={currentInterval} onChange={(e) => setIntervalDraft(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button className="btn-primary w-full" onClick={save} disabled={busy || !settings.data}>
            {busy && <Spinner />} Сохранить
          </button>
          <p className="mt-3 text-center text-[11px] text-white/30">
            Тихие часы, сводка и тишина — личные для каждого пользователя: в боте (/quiet, /digest, /mute) или в его Mini App.
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">🛡 Анти-бан</h2>
        <Card className="!animate-none space-y-3 text-sm">
          <Row k="Запросов всего" v={s.requestsTotal} />
          <Row k="Блокировок (403/капча)" v={s.blockedTotal} cls={s.blockedTotal > 0 ? 'text-warm' : ''} />
          <Row k="Часовой пояс" v={s.timezone} />
          <Row k="Версия" v={`v${s.version}`} />
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Прокси-пул ({s.proxies.length})</p>
            {s.proxies.length === 0 ? (
              <p className="text-xs text-white/35">Прокси не заданы — запросы идут напрямую. Для продакшена добавьте резидентные прокси в PROXIES.</p>
            ) : (
              s.proxies.map((p) => (
                <div key={p.url} className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs">
                  <span className="truncate font-mono">{p.url.replace(/\/\/.*@/, '//***@')}</span>
                  <span className={`shrink-0 ${p.dead ? 'text-hot' : p.cooldownSec > 0 ? 'text-warm' : 'text-ok'}`}>
                    {p.dead ? 'мёртв' : p.cooldownSec > 0 ? `cooldown ${p.cooldownSec}с` : `ok ${p.ok} / fail ${p.fail}`}
                  </span>
                </div>
              ))
            )}
          </div>
          {s.breakers.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Circuit breakers</p>
              {s.breakers.map((b) => (
                <div key={b.host} className="flex justify-between rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">
                  <span>{b.host}</span>
                  <span>
                    открыт ещё {b.openSec}с (fails: {b.fails})
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <h2 className="pt-2 text-lg font-semibold">🚀 Планировщик</h2>
        <Card className="!animate-none space-y-3 text-sm">
          <Row k="Выполняется сейчас" v={s.scheduler?.running ?? 0} />
          <Row k="Ждут очереди" v={s.scheduler?.due ?? 0} />
          <Row k="Uptime" v={`${Math.floor(s.uptimeSec / 60)} мин`} />
        </Card>
      </section>
    </div>
  )
}

export default function Settings({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const { show, node } = useToast()
  return (
    <div className="space-y-5">
      {node}
      <h2 className="text-lg font-semibold">⚙️ Настройки</h2>
      {me.mode === 'telegram' ? (
        <div className="max-w-lg space-y-4">
          <Notifications me={me} onMe={onMe} toast={show} />
          <p className="text-center text-[11px] text-white/25">
            {me.brand} v{me.version}
          </p>
        </div>
      ) : (
        <AdminSystem toast={show} />
      )}
    </div>
  )
}
