<div align="center">

# 💸 CheapKZ

**Self-hosted price monitoring for Kazakhstan — with "BUY NOW" alerts in Telegram.**

Watches **Kaspi.kz**, **OLX.kz**, **Krisha.kz** and flight prices, scores every deal with an *explainable* 0–100 Hot Score, and pings you the moment a price becomes anomalously low.

[![CI](https://github.com/Venius24/cheapkz/actions/workflows/ci.yml/badge.svg)](https://github.com/Venius24/cheapkz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2023-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-159%20passing-brightgreen)

**🇬🇧 English** · [🇷🇺 Русский](README.ru.md) · [Architecture](docs/ARCHITECTURE.md) · [Decisions (ADR)](docs/adr/README.md)

</div>

---

## Why this exists

Price trackers either need a SaaS subscription or break the first time a shop adds a captcha. CheapKZ is a small, readable, **single-process** service you can run on a $5 VPS:

- paste a link into the Telegram bot → it starts watching,
- it learns the price history of *that* item,
- it alerts you only when the price is genuinely good **and** says why.

It is also a deliberate exercise in building a scraper-backed service *responsibly*: polite by default, hard to abuse, and heavily tested.

## Highlights

| | |
|---|---|
| 🔥 **Explainable Hot Score** | 0–100 from discount vs. old price, position in the item's own history, depth below its maximum and freshness. Alerts read like *"−22% from old price · cheaper than 91% of its history"*. ([ADR 0005](docs/adr/0005-explainable-hot-score.md)) |
| 🛰 **Anomaly detector** | select Krisha districts on a live map or Kaspi categories — a periodic scan flags listings ≥ N% cheaper per m² than similar flats nearby and items that suddenly drop below their own median price |
| 🎯 **Alert rules** | target price · drop of N% · historical-low percentile · new listings matching keyword / price filters |
| 🧠 **Noise control** | per-rule cooldowns, dedup, quiet hours that *hot* alerts can break through, mute, daily digest, price-trend regression ("wait or buy") |
| 🛡 **Anti-ban HTTP layer** | per-host token bucket + jitter + global concurrency, UA rotation, weighted proxy pool with exponential cooldown, per-domain circuit breaker, captcha/DDoS-Guard detection |
| 🔒 **Security-minded** | SSRF guard re-validated on **every redirect hop**, secret redaction in logs/errors, constant-time token compare, HTML-escaped bot output |
| 📈 **Operable** | Prometheus `/metrics`, `/health`, retention job, Docker image running as non-root, SQLite in WAL mode |
| 🧩 **Extensible** | a source is one file returning `Offer[]`; a generic CSS-selector adapter covers any other site without code |
| 🧪 **Tested** | 159 tests: pure-logic unit tests, parser tests against fixtures, HTTP layer against a real local server, API integration tests |

## How it works

```
 Telegram bot ─┐                                   ┌─▶ Kaspi / OLX / Krisha / Flights / generic
 REST + React ─┼─▶ SQLite ◀─ Scheduler ─▶ runWatcher ─▶ HttpGuard  (SSRF · limiter · proxies · breaker)
               │      ▲                        │
               │      └────── alerts ◀── hotScore() + evaluateRules()   (pure functions)
               └─ Notifier ──▶ Telegram DM (quiet hours · mute · digest)
```

One watcher run: **fetch → normalise → filter → score → evaluate rules → cooldown → persist → deliver**.
Full walk-through in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

> Requires **Node.js ≥ 23** — CheapKZ uses the built-in `node:sqlite`, so there is nothing native to compile.

```bash
git clone https://github.com/Venius24/cheapkz.git
cd cheapkz
npm install
cp .env.example .env     # set ADMIN_TOKEN (and TELEGRAM_BOT_TOKEN for the bot)
npm run dev              # http://localhost:8080
```

### Docker

```bash
cp .env.example .env
mkdir -p data && sudo chown -R 1000:1000 data   # container runs as uid 1000
docker compose up -d --build
```

### Production build

```bash
npm run build && npm start
```

In `NODE_ENV=production` start-up **fails** if `ADMIN_TOKEN` is empty, shorter than 16 chars, or still the example value.

## Configuration

| Variable | Purpose |
|---|---|
| `ADMIN_TOKEN` | protects the dashboard and API (`openssl rand -hex 32`) |
| `TELEGRAM_BOT_TOKEN` | enables the bot (from [@BotFather](https://t.me/BotFather)); without it the web UI still works |
| `TRAVELPAYOUTS_TOKEN` | enables flight monitoring |
| `PROXIES` | comma-separated `http://user:pass@host:port` list |
| `MAX_CONCURRENCY`, `MIN_DELAY_MS` | global politeness knobs (default `3`, `900..2400`) |
| `RETENTION_DAYS` | price-history retention (default 365, `0` = keep forever) |
| `ALLOW_PRIVATE_TARGETS` | disables the SSRF guard — only for monitoring your own internal services |

Everything is documented in [`.env.example`](.env.example).

## Telegram bot

```text
<paste a kaspi / olx / krisha link>   start watching instantly
/list                                 watchers with ⏸ ▶ ↻ 🗑 buttons
/set 12 199990                        target price for watcher 12
/drop 12 15                           alert on a drop of ≥ 15%
/flights ALA NQZ 2026-09-12           watch flights
/hot                                  best deals right now
/quiet 23:00 07:00                    quiet hours (🔥 alerts break through)
/mute 2h · /digest 9 · /stats
```

## REST API

All routes except `/health` need `Authorization: Bearer <ADMIN_TOKEN>`.

```bash
# create a watcher — the kind is auto-detected from the URL
curl -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"url":"https://kaspi.kz/p/apple-iphone-15/105621344/","target_price":189990}' \
  http://localhost:8080/api/watchers

curl -H "Authorization: Bearer $T" "http://localhost:8080/api/deals?level=hot"
curl -H "Authorization: Bearer $T" http://localhost:8080/metrics     # Prometheus
```

Any other website, no code needed:

```json
{ "url": "https://example.com/product", "kind": "generic",
  "params": { "selector": ".price", "matchAll": false } }
```

## Engineering decisions

The interesting part of this repo is *why* it is built the way it is. Each decision has a short record in [`docs/adr/`](docs/adr/README.md):

| Decision | Short version |
|---|---|
| [`node:sqlite`, not a native driver](docs/adr/0001-sqlite-node-builtin.md) | zero native deps, trivial backups; cost: Node ≥ 23 |
| [Single egress point](docs/adr/0002-single-egress-http-guard.md) | adapters *cannot* skip rate limits, proxies or SSRF checks |
| [Pure scoring & rules](docs/adr/0003-pure-scoring-and-rules.md) | the product's core logic has no I/O, so it is trivially testable |
| [Manual redirects](docs/adr/0004-manual-redirects-ssrf.md) | a public URL redirecting to `169.254.169.254` must not slip through |
| [Weighted score, not ML](docs/adr/0005-explainable-hot-score.md) | small per-item data; users must be able to trust and read the result |

## Project layout

```
src/
  api/        Fastify REST, SPA hosting, /metrics
  bot/        grammY Telegram bot
  core/       hotScore, rules, formatting, notifier   (pure logic lives here)
  db/         node:sqlite wrapper, migrations, queries
  http/       HttpGuard, RateLimiter, Breaker, ProxyPool, SSRF guard
  sources/    kaspi · olx · krisha · flights · generic
  worker/     runWatcher pipeline + Scheduler
web/          React + Tailwind dashboard (Vite)
tests/        vitest suites
fixtures/     recorded HTML/JSON for parser tests
docs/         architecture + ADRs
```

## Development

```bash
npm run typecheck   # strict TS, server + web
npm test            # 159 tests
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new source.

## Responsible use

CheapKZ is built to be polite: low default rates, jitter, caching, circuit breakers. Keep polling intervals at 15–30 minutes or more, respect each site's Terms of Service, and don't use it for bulk scraping. The project is **not affiliated** with Kaspi, OLX, Krisha or Aviasales; all trademarks belong to their owners.

## Roadmap

- [ ] More delivery channels (email, Pushover)
- [ ] Seasonality-aware price forecast
- [ ] Currency-rate and subscription monitoring
- [ ] Pin the resolved IP per request to remove the DNS-rebinding window ([ADR 0004](docs/adr/0004-manual-redirects-ssrf.md))

## License

[MIT](LICENSE) © 2026 Venius24
