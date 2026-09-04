import path from 'node:path'
import { loadConfig, validateConfig } from './config.js'
import { log } from './log.js'
import { openDb } from './db/index.js'
import { HttpGuard } from './http/client.js'
import { ProxyPool } from './http/proxies.js'
import { Notifier } from './core/notify.js'
import { Scheduler } from './worker/index.js'
import { createApp } from './api/app.js'
import { createBot } from './bot/index.js'

async function main(): Promise<void> {
  const cfg = loadConfig()
  log.setLevel(cfg.logLevel)
  log.info(`${cfg.brand} v${cfg.version} стартует (${cfg.env})`)

  const issues = validateConfig(cfg)
  for (const i of issues) (i.level === 'error' ? log.error : log.warn)(`конфигурация: ${i.text}`)
  if (cfg.env === 'production' && issues.some((i) => i.level === 'error')) {
    log.error('старт остановлен: исправьте .env или запустите с NODE_ENV=development')
    process.exit(1)
  }

  const db = openDb(path.isAbsolute(cfg.dbPath) ? cfg.dbPath : path.resolve(cfg.dbPath))
  const pool = new ProxyPool(cfg.proxies, db)
  if (!pool.size) {
    log.warn('прокси не заданы (PROXIES=…) — запросы пойдут напрямую; при банах добавьте резидентные прокси')
  }
  const guard = new HttpGuard(cfg, db, pool)
  const notifier = new Notifier({ db, brand: cfg.brand, timezone: cfg.timezone })

  const deps = { cfg, db, guard, notifier }
  const scheduler = new Scheduler(deps)

  // Telegram
  let botStop: (() => Promise<void>) | null = null
  if (cfg.telegramToken) {
    try {
      const bot = createBot({ cfg, db, scheduler })
      notifier.setSender(async (tgId, html) => {
        await bot.api.sendMessage(tgId, html, { parse_mode: 'HTML' })
      })
      void bot.start({ onStart: (me) => log.info(`бот запущен: @${me.username}`) }).catch((e) => log.error('bot stopped', e))
      botStop = () => bot.stop()
      log.info('telegram-бот включён')
    } catch (e) {
      log.error('не удалось создать бота', e)
    }
  } else {
    log.warn('TELEGRAM_BOT_TOKEN пуст — алерты копятся в БД и видны в веб-панели')
    notifier.setSender(async (_tgId, html) => {
      log.info(`[алерт без бота] ${html.replace(/<[^>]+>/g, ' ').slice(0, 160)}`)
    })
  }

  scheduler.start()

  // периодическая доставка уведомлений
  const flushTimer = setInterval(() => void notifier.flushOnce(), 10_000)

  const app = createApp({ cfg, db, guard, scheduler })
  await app.listen({ port: cfg.port, host: '0.0.0.0' })
  log.info(`панель: ${cfg.baseUrl} (порт ${cfg.port})`)

  let stopping = false
  const shutdown = async (code = 0): Promise<void> => {
    if (stopping) return
    stopping = true
    log.info('останавливаемся…')
    clearInterval(flushTimer)
    scheduler.stop()
    await botStop?.().catch(() => {})
    await app.close().catch(() => {})
    await guard.close().catch(() => {})
    try {
      db.close()
    } catch {
      /* уже закрыта */
    }
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  // необработанный отказ не должен оставлять процесс в неопределённом состоянии
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', e))
  process.on('uncaughtException', (e) => {
    log.error('uncaughtException — завершаемся', e)
    void shutdown(1)
  })
}

main().catch((e) => {
  log.error('фатальная ошибка старта', e)
  process.exit(1)
})
