# 💸 CheapKZ

**🇷🇺 Русский** · [🇬🇧 English](README.md) · [Архитектура](docs/ARCHITECTURE.md) · [ADR](docs/adr/README.md)

**Мониторинг цен по Казахстану с алертами «ЛОВИ СЕЙЧАС» 🔥**

Следит за товарами **Kaspi.kz**, выдачей **OLX.kz**, арендой и продажей недвижимости на **Krisha.kz** и ценами на **авиабилеты** — и кричит в Telegram в тот момент, когда цена становится аномально низкой.

---

## ✨ Возможности

| Блок | Что умеет |
|---|---|
| 🛒 Источники | Kaspi (offers API), OLX (поиск), Krisha (выдача), авиабилеты (Travelpayouts/Aviasales) + **универсальный CSS-адаптер для любого сайта** |
| 🔥 Hot Score | Объяснимая оценка 0–100: скидка от старой цены, положение в собственной истории, глубина ниже максимума, свежесть. Уровни 🔥 hot / 🌤 warm / ❄️ cool |
| 🎯 Правила алертов | Целевая цена · падение на N% · исторический минимум (перцентиль ≤10%) · новые объявления по фильтрам (ключевые слова, мин/макс цена) |
| 🧠 Умные фичи | Тренд цены (линейная регрессия «ждать или брать»), дайджест за сутки, тихие часы с прорывом горячих алертов, мьют, дедупликация и кулдауны |
| 🤖 Telegram-бот | Пришл ссылку — уже следит. `/set`, `/drop`, `/flights`, `/hot`, `/stats`, `/digest`, `/quiet`, `/mute`, inline-кнопки |
| 📊 Веб-панель | Дашборд, карточки наблюдений со спарклайнами, радар сделок с фильтрами, статус анти-бана, тёмный дизайн |
| 🛡 Анти-бан | Token-bucket на домен + jitter + глобальный параллелизм, ротация реалистичных User-Agent, пул прокси с весами/cooldown/автоисключением, circuit breaker, ретраи через другой выход |
| 🔒 Безопасность | SSRF-guard на каждый хоп редиректа, редакция секретов в логах и ошибках, постоянное по времени сравнение токена, экранирование HTML в сообщениях |
| 📈 Эксплуатация | Prometheus `/metrics` (HELP/TYPE), `/health`, REST API, SQLite (WAL, без нативных сборок), автоматический ретеншен, Docker, автотесты |

---

## 🏗 Архитектура

```
┌────────────┐   ссылки    ┌─────────────────┐
│ Telegram   │────────────▶│   Fastify API   │◀─── React SPA (dist/web)
│ бот grammy │             └────────┬────────┘
└────────────┘                      │
┌────────────┐   cron/tick   ┌──────▼─────────┐   adapters   ┌──────────────┐
│ Scheduler  │──────────────▶│ runWatcher     │─────────────▶│ Kaspi / OLX  │
│ (croner)   │               │ score → rules  │              │ Krisha / TP  │
└────────────┘               └──────┬─────────┘              └──────▲───────┘
                                    │ alerts                        │ HttpGuard:
                              ┌─────▼──────┐                       │ limiter+jitter
                              │ Notifier   │──▶ Telegram DM        │ proxy pool
                              └────────────┘                       │ breaker+retry
                                                                (единственный выход
                                                                 в интернет)
                            Всё состояние — SQLite (data/cheapkz.db)
```

## 🚀 Быстрый старт

Требуется **Node.js ≥ 23** (используется встроенный `node:sqlite` — ничего компилировать не нужно).
На Node 22 и ниже приложение не стартует: модуля `node:sqlite` там нет.

```bash
npm install
cp .env.example .env      # заполните токены (см. ниже)
npm run dev               # http://localhost:8080
```

Продакшен-сборка:

```bash
npm run build             # web → dist/web, server → dist
node dist/index.js        # или npm start
```

Docker:

```bash
cp .env.example .env      # правим токены
docker compose up -d --build
```

## 🔑 Какие токены править (`.env`)

| Переменная | Зачем | Где взять |
|---|---|---|
| `ADMIN_TOKEN` | доступ к веб-панели и API | `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | алерты и управление ботом | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TRAVELPAYOUTS_TOKEN` | мониторинг авиабилетов | [travelpayouts.com](https://www.travelpayouts.com) → аккаунт → API token |
| `PROXIES` | анти-бан: `http://user:pass@ip:port,…` | ваш провайдер резидентных прокси |
| `BASE_URL`, `PORT`, `BRAND_NAME`, `TZ_NAME` | брендинг и адрес | — |
| `RETENTION_DAYS` | сколько дней хранить историю цен (по умолчанию 365, `0` — не чистить) | — |
| `ALLOW_PRIVATE_TARGETS` | разрешить наблюдения за внутренней сетью — отключает защиту от SSRF | — |

В продакшене (`NODE_ENV=production`) старт прерывается, если `ADMIN_TOKEN` пуст,
короче 16 символов или оставлен значением из `.env.example`.

> Без бота и билетного токена всё остальное работает: алерты копятся в БД и видны в веб-панели.

## 🤖 Команды бота

```
просто пришли ссылку kaspi/olx/krisha — слежка начнётся мгновенно
/list                 карточки с кнопками ⏸ ▶ ↻ 🗑
/set 12 199990        целевая цена
/drop 12 15           алерт при падении ≥15%
/flights ALA NQZ 2026-09-12 [2026-09-19]
/hot                  топ горячих сделок прямо сейчас
/stats                статистика и экономия
/mute 2h              тишина на срок
/digest 9             сводка каждый день в 9:00
/quiet 23:00 07:00    тихие часы (🔥 прорываются)
/delete 12
```

## 🛡 Как устроен анти-бан («главное — не уебать IP»)

1. **Token bucket на каждый домен** — Kaspi не чаще ~1 запроса/4с, Krisha ~1/5с и т.д.
2. **Jitter 0.9–2.4с** на каждый запрос — поведение неотличимо от человека по таймингам.
3. **Глобальный параллелизм** (по умолчанию 3) — никаких очередей «стеной запросов».
4. **Ротация User-Agent** (5 актуальных браузерных строк) + согласованные Accept-Language/sec-fetch заголовки.
5. **Прокси-пул**: взвешенный выбор (успехи/провалы), LRU, экспоненциальный cooldown 1м→5м→25м→2ч→6ч, автоисключение мёртвых, ретрай через другой выход.
6. **Circuit breaker на домен**: после серии блокировок пауза 1→30 минут вместо долбления.
7. **Детект капчи/DDoS-Guard** по телу ответа → считается блокировкой, а не ошибкой парсера.
8. **Редиректы обрабатываются вручную**, максимум 4 хопа: каждый следующий адрес заново проверяется
   на принадлежность внутренней сети, а общий таймаут не сбрасывается между хопами.
9. **Тело ответа ограничено 4 МБ** — «бесконечная» страница не съест память процесса.

Рекомендации: интервалы ≥15–30 мин, для продакшена — свои резидентные прокси, не ставьте интервал <5 мин (ограничено API).

## 🔒 Безопасность

- **SSRF.** Ссылки на наблюдения приходят от пользователя, поэтому перед каждым запросом
  (и на каждом редиректе) хост резолвится и проверяется: `127.0.0.0/8`, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16` (метаданные облаков), CGNAT, IPv6 ULA/link-local — запрещены.
  Снимается только явным `ALLOW_PRIVATE_TARGETS=1`.
- **Секреты в логах.** Токены в query-параметрах и пароли в URL прокси вырезаются из
  сообщений об ошибках до того, как те попадут в лог, БД и Telegram.
- **Токен панели.** Сравнение идёт по SHA-256 через `timingSafeEqual` — постоянное время
  и никакой утечки длины; многобайтные токены не роняют сервер.
- **HTML-инъекции.** Названия и ссылки из чужой выдачи экранируются вместе с кавычками,
  поэтому URL с `"` не может выломаться из атрибута `href` в сообщении бота.

## 📡 REST API

Все запросы (кроме `/health`) требуют заголовок `Authorization: Bearer <ADMIN_TOKEN>`
(либо `?token=…` — для Prometheus и curl).

```bash
# создать наблюдение (kind определится автоматически)
curl -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"url":"https://kaspi.kz/p/apple-iphone-15/105621344/","target_price":189990}' \
  http://localhost:8080/api/watchers

# список, история, принудительная проверка
curl -H "Authorization: Bearer $T" http://localhost:8080/api/watchers
curl -H "Authorization: Bearer $T" http://localhost:8080/api/watchers/1/history?days=14
curl -X POST -H "Authorization: Bearer $T" http://localhost:8080/api/watchers/1/run

# радар сделок и статистика
curl -H "Authorization: Bearer $T" "http://localhost:8080/api/deals?level=hot"
curl -H "Authorization: Bearer $T" http://localhost:8080/api/stats

# метрики для Prometheus
curl -H "Authorization: Bearer $T" http://localhost:8080/metrics
```

Универсальный источник (любой сайт):

```json
{
  "url": "https://example.com/product",
  "kind": "generic",
  "params": { "selector": ".price", "matchAll": false }
}
```

## 🗄 Структура проекта

```
src/
  index.ts          точка входа (API + бот + планировщик)
  config.ts         .env конфиг
  db/               node:sqlite обёртка, миграции, запросы
  http/
    limiter.ts      token bucket + concurrency + circuit breaker
    proxies.ts      пул прокси с cooldown
    safeUrl.ts      SSRF-guard: только публичные http/https-адреса
    client.ts       HttpGuard — единственный выход в сеть
  sources/          адаптеры: kaspi, olx, krisha, flights, generic
  core/
    hotScore.ts     оценка «лови сейчас» 0–100
    rules.ts        движок правил алертов
    format.ts       HTML-сообщения
    notify.ts       доставка, тихие часы, дайджесты
  worker/index.ts   runWatcher pipeline + Scheduler
  bot/index.ts      grammy-бот
  api/app.ts        Fastify REST + SPA + /metrics
web/                React + Tailwind панель
tests/              vitest: 116 автотестов
fixtures/           фикстуры HTML/JSON для тестов парсеров
```

## 🧪 Тесты и проверки

```bash
npm test            # 116 unit/integration тестов
npm run typecheck   # строгая типизация сервера и фронтенда
npm run build       # сборка продакшена
```

Покрыто: Hot Score и перцентили, правила алертов и фильтры, лимитер/брейкер (тайминги),
прокси-пул (LRU/cooldown/dead), SSRF-guard, HttpGuard на живом локальном сервере
(редиректы, циклы, 403/5xx/404, лимит тела, редакция секретов), все парсеры источников
против фикстур, форматирование денег/сообщений и экранирование HTML, отсрочка доставки
в тихие часы и мьют, кэш с TTL и ретеншен, валидация конфигурации, REST API
(auth, CRUD, history, deals, settings, Prometheus-формат), конвейер runWatcher.

CI (`.github/workflows/ci.yml`) прогоняет typecheck, тесты и сборку на Node 24.

## 💼 Деплой

**Docker (рекомендуется):** см. выше. Данные живут в `./data`.
Контейнер работает от непривилегированного пользователя `node` (uid 1000), поэтому
перед первым запуском выдайте ему права на каталог данных: `sudo chown -R 1000:1000 ./data`.

**systemd:**
```ini
[Unit]
Description=CheapKZ
After=network.target
[Service]
WorkingDirectory=/opt/cheapkz
ExecStart=/usr/bin/node dist/index.js
Restart=always
EnvironmentFile=/opt/cheapkz/.env
[Install]
WantedBy=multi-user.target
```

Обновление: `git pull && npm ci && npm run build && systemctl restart cheapkz`.

White-label: поменяйте `BRAND_NAME` — имя подставится в сообщения бота, API и заголовок панели.

## ⚖️ Дисклеймер

Проект обращается к публичным страницам вежливо (лимитеры, роботополитика). Соблюдайте ToS источников, не используйте агрессивные интервалы. Авторские данные принадлежат их владельцам; сервис **не аффилирован** с Kaspi/OLX/Krisha/Aviasales.

## 🗺 Roadmap

- Pushover/email-каналы доставки
- Прогноз цены (сезонность) и «подождать X дней»
- Мониторинг валютных курсов и подписок
- Мультиаренда с тарифами
