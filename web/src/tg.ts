/**
 * Telegram Mini App. Telegram открывает панель с `#tgWebAppData=…` в адресе —
 * забираем initData до того, как hash-роутер его перепишет, и только тогда
 * подгружаем официальный SDK (в обычном браузере он не нужен).
 */

interface TgWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  close(): void
  setHeaderColor(c: string): void
  setBackgroundColor(c: string): void
  disableVerticalSwipes?: () => void
  showConfirm(text: string, cb: (ok: boolean) => void): void
  openLink(url: string, opts?: { try_instant_view?: boolean }): void
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void
    notificationOccurred(type: 'success' | 'error' | 'warning'): void
    selectionChanged(): void
  }
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

const KEY = 'ck_tg_init'
const SDK = 'https://telegram.org/js/telegram-web-app.js'

export const webApp = (): TgWebApp | null => {
  const w = window.Telegram?.WebApp
  return w && sessionStorage.getItem(KEY) ? w : null
}

function captureInitData(): boolean {
  try {
    const hash = new URLSearchParams(location.hash.slice(1))
    const data = hash.get('tgWebAppData')
    if (data) sessionStorage.setItem(KEY, data)
    return Boolean(sessionStorage.getItem(KEY))
  } catch {
    return false
  }
}

function loadSdk(): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = SDK
    s.onload = () => resolve()
    s.onerror = () => resolve()
    document.head.appendChild(s)
    // SDK недоступен — панель всё равно работает, просто без нативных диалогов
    setTimeout(resolve, 4000)
  })
}

export async function bootTelegram(): Promise<void> {
  if (!captureInitData()) return
  document.documentElement.classList.add('in-tg')
  await loadSdk()
  const tg = window.Telegram?.WebApp
  if (!tg) return
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  try {
    tg.setHeaderColor('#0b0d14')
    tg.setBackgroundColor('#0b0d14')
  } catch {
    /* старые клиенты Telegram */
  }
  if (location.hash.includes('tgWebAppData')) history.replaceState(null, '', `${location.pathname}#/dashboard`)
}

export const haptic = {
  tap: () => webApp()?.HapticFeedback?.impactOccurred('light'),
  ok: () => webApp()?.HapticFeedback?.notificationOccurred('success'),
  bad: () => webApp()?.HapticFeedback?.notificationOccurred('error'),
  select: () => webApp()?.HapticFeedback?.selectionChanged()
}

/** Подтверждение: нативный диалог Telegram (window.confirm там не работает) или браузерный. */
export function confirmAsk(text: string): Promise<boolean> {
  const tg = webApp()
  if (tg) return new Promise((resolve) => tg.showConfirm(text, resolve))
  return Promise.resolve(window.confirm(text))
}
