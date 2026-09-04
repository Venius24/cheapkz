import { useEffect, useState } from 'react'
import { api, type SystemInfo } from '../api'
import { Card, Field, useToast, useInterval } from '../ui'

function TokenRow({ name, ok, env }: { name: string; ok: boolean; env: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <div>
        <div className="font-medium">{name}</div>
        <div className="text-xs text-white/35">.env → <code className="text-cy/80">{env}</code></div>
      </div>
      <span className={`chip ${ok ? 'bg-ok/15 text-ok' : 'bg-hot/15 text-hot'}`}>{ok ? '✓ настроен' : '✗ не задан'}</span>
    </div>
  )
}

export default function Settings() {
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [quietFrom, setQuietFrom] = useState('')
  const [quietTo, setQuietTo] = useState('')
  const { show, node } = useToast()

  const load = () => {
    api.system().then(setSys).catch(() => {})
    api.settings().then((s) => {
      setSettings(s)
      setQuietFrom(s.quiet_from ?? '')
      setQuietTo(s.quiet_to ?? '')
    }).catch(() => {})
  }
  useEffect(load, [])
  useInterval(load, 60_000)

  if (!sys) return <div className="py-20 text-center text-white/30">Загрузка…</div>

  const save = async () => {
    await api.saveSettings({ quiet_from: quietFrom || null, quiet_to: quietTo || null })
    show('Настройки сохранены ✅')
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {node}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">🔑 Токены</h2>
        <TokenRow name="Telegram-бот" ok={sys.tokens.telegram} env="TELEGRAM_BOT_TOKEN" />
        <TokenRow name="Авиабилеты (Travelpayouts)" ok={sys.tokens.travelpayouts} env="TRAVELPAYOUTS_TOKEN" />
        <TokenRow name="Админ-доступ к панели" ok={sys.tokens.admin} env="ADMIN_TOKEN" />
        <p className="text-xs text-white/35">
          Токены задаются в файле <code className="text-cy/80">.env</code> рядом с проектом. После правки перезапустите сервис.
        </p>

        <h2 className="pt-4 text-lg font-semibold">⚙️ Общие настройки</h2>
        <Card>
          <Field label="Тихие часы с (HH:MM)">
            <input className="input" placeholder="23:00" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
          </Field>
          <Field label="Тихие часы до (HH:MM)">
            <input className="input" placeholder="07:00" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" onClick={save}>Сохранить</button>
          <p className="mt-2 text-center text-[11px] text-white/30">🔥 Горячие алерты прорываются сквозь тихие часы</p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">🛡 Анти-бан</h2>
        <Card className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-white/50">Запросов всего</span><b>{sys.requestsTotal}</b></div>
          <div className="flex justify-between"><span className="text-white/50">Блокировок (403/капча)</span><b className={sys.blockedTotal > 0 ? 'text-warm' : ''}>{sys.blockedTotal}</b></div>
          <div className="flex justify-between"><span className="text-white/50">Часовой пояс</span><b>{sys.timezone}</b></div>
          <div className="flex justify-between"><span className="text-white/50">Версия</span><b>v{sys.version}</b></div>
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Прокси-пул ({sys.proxies.length})</p>
            {sys.proxies.length === 0 ? (
              <p className="text-xs text-white/35">Прокси не заданы — запросы идут напрямую. Для продакшена добавьте резидентные прокси в PROXIES.</p>
            ) : (
              sys.proxies.map((p) => (
                <div key={p.url} className="mb-1 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs">
                  <span className="truncate font-mono">{p.url.replace(/\/\/.*@/, '//***@')}</span>
                  <span className={p.dead ? 'text-hot' : p.cooldownSec > 0 ? 'text-warm' : 'text-ok'}>
                    {p.dead ? 'мёртв' : p.cooldownSec > 0 ? `cooldown ${p.cooldownSec}с` : `ok ${p.ok} / fail ${p.fail}`}
                  </span>
                </div>
              ))
            )}
          </div>
          {sys.breakers.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Circuit breakers</p>
              {sys.breakers.map((b) => (
                <div key={b.host} className="flex justify-between rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">
                  <span>{b.host}</span><span>открыт ещё {b.openSec}с (fails: {b.fails})</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <h2 className="pt-2 text-lg font-semibold">🚀 Планировщик</h2>
        <Card className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-white/50">Выполняется сейчас</span><b>{sys.scheduler?.running ?? 0}</b></div>
          <div className="flex justify-between"><span className="text-white/50">Ждут очереди</span><b>{sys.scheduler?.due ?? 0}</b></div>
          <div className="flex justify-between"><span className="text-white/50">Uptime</span><b>{Math.floor(sys.uptimeSec / 60)} мин</b></div>
        </Card>
      </section>
    </div>
  )
}
