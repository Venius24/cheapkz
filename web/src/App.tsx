import { useEffect, useState } from 'react'
import { api, clearToken, setToken } from './api'
import Dashboard from './pages/Dashboard'
import Watchers from './pages/Watchers'
import Radar from './pages/Radar'
import SettingsPage from './pages/Settings'

type Tab = 'dashboard' | 'watchers' | 'radar' | 'settings'

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'dashboard', icon: '📊', label: 'Обзор' },
  { id: 'watchers', icon: '👀', label: 'Наблюдения' },
  { id: 'radar', icon: '📡', label: 'Радар' },
  { id: 'settings', icon: '⚙️', label: 'Настройки' }
]

function Login({ onOk }: { onOk: () => void }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/system', { headers: { authorization: `Bearer ${token.trim()}` } })
      if (!r.ok) throw new Error('bad')
      // токен сохраняем только после успешной проверки
      setToken(token.trim())
      onOk()
    } catch {
      clearToken()
      setErr('Токен не принят. Проверьте ADMIN_TOKEN в .env')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="glass w-full max-w-sm animate-fadeUp space-y-4 p-8 shadow-glow">
        <h1 className="text-center text-2xl font-bold">
          💸 Cheap<span className="bg-gradient-to-r from-vio to-cy bg-clip-text text-transparent">KZ</span>
        </h1>
        <p className="text-center text-xs text-white/40">Панель мониторинга цен и алертов «лови сейчас»</p>
        <input className="input" type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
        {err && <p className="text-center text-xs text-hot">{err}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.replace('#/', '')
    return (TABS.some((t) => t.id === h) ? h : 'dashboard') as Tab
  })

  useEffect(() => {
    api
      .system()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
  }, [])

  useEffect(() => {
    location.hash = `/${tab}`
  }, [tab])

  if (authed === null) return null
  if (!authed) return <Login onOk={() => setAuthed(true)} />

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 p-4 lg:p-6">
      {/* Sidebar */}
      <aside className="glass sticky top-6 hidden h-fit w-56 shrink-0 flex-col gap-1 p-3 lg:flex">
        <div className="mb-3 px-3 py-2 text-xl font-bold">
          💸 Cheap<span className="bg-gradient-to-r from-vio to-cy bg-clip-text text-transparent">KZ</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm transition ${
              tab === t.id ? 'bg-gradient-to-r from-vio/25 to-cy/15 font-semibold text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
        <button
          className="mt-auto rounded-xl px-4 py-2 text-left text-xs text-white/35 transition hover:bg-white/5 hover:text-white"
          onClick={() => {
            clearToken()
            setAuthed(false)
          }}
        >
          ⎋ Выйти
        </button>
        <div className="px-3 pt-3 text-[10px] leading-relaxed text-white/25">
          Мониторинг цен РК<br />Kaspi · OLX · Krisha · Билеты
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 pb-20 lg:pb-0">
        {/* Mobile header */}
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="text-lg font-bold">💸 CheapKZ</div>
        </div>

        {tab === 'dashboard' && <Dashboard go={(t) => setTab(t as Tab)} />}
        {tab === 'watchers' && <Watchers />}
        {tab === 'radar' && <Radar />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      {/* Mobile tabbar */}
      <nav className="glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl px-2 py-2 lg:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-[10px] ${tab === t.id ? 'bg-vio/20 text-white' : 'text-white/45'}`}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
