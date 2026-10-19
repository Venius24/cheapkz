import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, checkToken, clearToken, inTelegram, setToken, UNAUTHORIZED_EVENT, type Me } from './api'
import { ErrorBoundary, Spinner, errorText } from './ui'
import { haptic } from './tg'
import Dashboard from './pages/Dashboard'
import Watchers from './pages/Watchers'
import Radar from './pages/Radar'
import Detector from './pages/Detector'
import SettingsPage from './pages/Settings'

type Tab = 'dashboard' | 'watchers' | 'detector' | 'radar' | 'settings'

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'dashboard', icon: '📊', label: 'Обзор' },
  { id: 'watchers', icon: '👀', label: 'Наблюдения' },
  { id: 'detector', icon: '🛰', label: 'Детектор' },
  { id: 'radar', icon: '📡', label: 'Радар' },
  { id: 'settings', icon: '⚙️', label: 'Настройки' }
]

const tabFromHash = (): Tab => {
  const h = location.hash.replace('#/', '')
  return (TABS.some((t) => t.id === h) ? h : 'dashboard') as Tab
}

const Logo = ({ className = '' }: { className?: string }) => (
  <span className={`font-bold ${className}`}>
    💸 Cheap<span className="bg-gradient-to-r from-vio to-cy bg-clip-text text-transparent">KZ</span>
  </span>
)

function Login({ onOk, reason }: { onOk: () => void; reason?: string }) {
  const [token, setTokenInput] = useState('')
  const [err, setErr] = useState(reason ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const r = await checkToken(token.trim())
    setBusy(false)
    if (r === 'ok') {
      // токен сохраняем только после успешной проверки
      setToken(token.trim())
      onOk()
    } else {
      setErr(r === 'bad' ? 'Токен не принят. Проверьте ADMIN_TOKEN в .env' : 'Сервер недоступен. Запущен ли CheapKZ?')
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="glass w-full max-w-sm animate-fadeUp space-y-4 p-8 shadow-glow">
        <h1 className="text-center text-2xl">
          <Logo />
        </h1>
        <p className="text-center text-xs text-white/40">Панель мониторинга цен и алертов «лови сейчас»</p>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="ADMIN_TOKEN"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
        />
        {err && <p className="text-center text-xs text-hot">{err}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy || !token.trim()}>
          {busy ? <Spinner /> : null} {busy ? 'Проверяю…' : 'Войти'}
        </button>
        <p className="text-center text-[11px] text-white/25">Или откройте панель из Telegram-бота — без токена</p>
      </form>
    </div>
  )
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="animate-pulse text-3xl">
        <Logo />
      </div>
      <div className="flex items-center gap-2 text-sm text-white/40">
        <Spinner /> {text}
      </div>
    </div>
  )
}

function Offline({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  useEffect(() => {
    const t = setTimeout(onRetry, 5000)
    return () => clearTimeout(t)
  }, [onRetry])
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm animate-fadeUp space-y-3 p-8 text-center">
        <div className="text-4xl">📡</div>
        <h1 className="font-semibold">Сервер недоступен</h1>
        <p className="text-sm text-white/45">{errorText(error)}. Повторяем каждые 5 секунд.</p>
        <button className="btn-primary w-full" onClick={onRetry}>
          ↻ Повторить сейчас
        </button>
      </div>
    </div>
  )
}

function TelegramDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm space-y-3 p-8 text-center">
        <div className="text-4xl">🔒</div>
        <h1 className="font-semibold">Сессия Telegram устарела</h1>
        <p className="text-sm text-white/45">Закройте окно и откройте панель заново кнопкой в боте.</p>
      </div>
    </div>
  )
}

type Boot = { s: 'checking' } | { s: 'ok'; me: Me } | { s: 'login'; reason?: string } | { s: 'offline'; error: unknown } | { s: 'tg-denied' }

export default function App() {
  const [boot, setBoot] = useState<Boot>({ s: 'checking' })
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const tg = inTelegram()

  const check = useCallback(() => {
    api
      .me()
      .then((me) => setBoot({ s: 'ok', me }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.unauthorized) setBoot(tg ? { s: 'tg-denied' } : { s: 'login' })
        else setBoot({ s: 'offline', error: e })
      })
  }, [tg])

  useEffect(check, [check])

  // любой 401 посреди работы (сменили ADMIN_TOKEN, перезапуск) — на экран входа, а не вечная загрузка
  useEffect(() => {
    const onUnauthorized = () => {
      if (tg) return setBoot({ s: 'tg-denied' })
      clearToken()
      setBoot({ s: 'login', reason: 'Сессия истекла — войдите снова' })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [tg])

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setTab = (t: Tab) => {
    if (t !== tab) haptic.select()
    setTabState(t)
    history.replaceState(null, '', `#/${t}`)
    window.scrollTo({ top: 0 })
  }

  if (boot.s === 'checking') return <Splash text="Подключаюсь к серверу…" />
  if (boot.s === 'offline') return <Offline error={boot.error} onRetry={check} />
  if (boot.s === 'tg-denied') return <TelegramDenied />
  if (boot.s === 'login') return <Login reason={boot.reason} onOk={check} />

  const me = boot.me
  const who = me.mode === 'telegram' ? (me.user?.username ? `@${me.user.username}` : 'Telegram') : 'админ'
  const logout = () => {
    clearToken()
    setBoot({ s: 'login' })
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 p-4 lg:p-6">
      {/* Sidebar */}
      <aside className="glass sticky top-6 hidden h-fit w-56 shrink-0 flex-col gap-1 p-3 lg:flex">
        <div className="mb-3 px-3 py-2 text-xl">
          <Logo />
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm transition ${
              tab === t.id ? 'bg-gradient-to-r from-vio/25 to-cy/15 font-semibold text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-2 text-xs text-white/35">
          <span className="truncate">👤 {who}</span>
          {!tg && (
            <button className="hover:text-white" onClick={logout} title="Выйти">
              ⎋ Выйти
            </button>
          )}
        </div>
        <div className="px-3 pt-1 text-[10px] leading-relaxed text-white/25">
          Мониторинг цен РК
          <br />
          Kaspi · OLX · Krisha · Билеты
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 pb-28 lg:pb-0">
        {/* Mobile header */}
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="text-lg">
            <Logo />
          </div>
          <div className="flex items-center gap-3 text-xs text-white/40">
            <span className="max-w-[140px] truncate">{who}</span>
            {!tg && (
              <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={logout}>
                Выйти
              </button>
            )}
          </div>
        </div>

        <ErrorBoundary key={tab}>
          {tab === 'dashboard' && <Dashboard go={(t) => setTab(t as Tab)} />}
          {tab === 'watchers' && <Watchers />}
          {tab === 'detector' && <Detector />}
          {tab === 'radar' && <Radar />}
          {tab === 'settings' && <SettingsPage me={me} onMe={(m) => setBoot({ s: 'ok', me: m })} />}
        </ErrorBoundary>
      </main>

      {/* Mobile tabbar */}
      <nav
        className="glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl !bg-panel/90 px-1 py-1.5 lg:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] transition ${
              tab === t.id ? 'bg-vio/20 text-white' : 'text-white/45'
            }`}
          >
            <span className="text-base">{t.icon}</span>
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
