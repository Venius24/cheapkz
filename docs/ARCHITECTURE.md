# Architecture

CheapKZ is a single Node.js process that bundles four concerns: an HTTP API with a React SPA, a Telegram bot, a scheduler/worker and a notifier. All state lives in one SQLite file.

```
              ┌──────────────┐        ┌───────────────────────┐
 Telegram ───▶│  grammY bot  │───────▶│                       │
              └──────────────┘        │      SQLite (WAL)     │
              ┌──────────────┐        │  users · watchers ·   │
 Browser ────▶│ Fastify API  │───────▶│  offers · price_points│
   (SPA)      │  + /metrics  │        │ alerts · proxies · kv │
              └──────────────┘        └──────────▲────────────┘
              ┌──────────────┐  runWatcher()     │
 tick (20 s)─▶│  Scheduler   │───────────────────┤
  + cron      └──────┬───────┘                   │
                     │ adapter.fetch()           │ alerts
              ┌──────▼───────┐            ┌──────┴──────┐
              │  HttpGuard   │            │  Notifier   │──▶ Telegram DM
              └──────────────┘            └─────────────┘
```

## Request path of one watcher run

`src/worker/index.ts → runWatcher()`

1. **Fetch** — the source adapter (`kaspi`, `olx`, `krisha`, `flights`, `generic`) calls `HttpGuard.getText()`. Adapters never touch the network directly.
2. **Normalise** — every adapter returns `Offer[]` (`src/sources/types.ts`), so the rest of the pipeline is source-agnostic.
3. **Filter** — keyword / price filters decide which *new* offers are interesting.
4. **Score** — `hotScore()` (pure) turns price + history into 0–100 with a human-readable reason.
5. **Rules** — `evaluateRules()` (pure) returns which alert rules fired.
6. **Cooldown & persist** — per-rule cooldowns (stored in `kv`) suppress repeats; alerts are inserted into the DB.
7. **Deliver** — a separate flush loop in `Notifier` sends pending alerts, honouring quiet hours, mute and hot-breakthrough.

Steps 4 and 5 are deliberately pure functions with no I/O. That is what makes them cheap to test exhaustively.

## Outbound traffic: `HttpGuard`

Single egress point. Layers, outermost first:

| Layer | File | Purpose |
|---|---|---|
| SSRF check | `http/safeUrl.ts` | scheme allow-list, resolve host, reject private / link-local / CGNAT ranges. Re-run on every redirect hop. |
| Circuit breaker | `http/limiter.ts` (`Breaker`) | after N block responses a domain is paused with exponential back-off (1 → 30 min) |
| Rate limiter | `http/limiter.ts` (`RateLimiter`) | token bucket per host + global concurrency + random jitter |
| Proxy pool | `http/proxies.ts` | weighted pick, LRU tie-break, exponential cooldown, auto-eviction; retries use a different exit |
| Body cap | `http/client.ts` | responses truncated at 4 MiB |
| Block detection | `http/client.ts` | captcha / DDoS-Guard markers in the body count as a *block*, not as a parser error |

## Data model

Defined as ordered migrations in `src/db/client.ts`, applied with `PRAGMA user_version` inside a transaction.

- `watchers` — what to watch, thresholds, schedule, last result
- `offers` — latest snapshot of every listing seen (`UNIQUE(watcher_id, external_id)`)
- `price_points` — time series of the best price per watcher (written only on change)
- `alerts` — produced alerts and delivery state
- `proxies` — per-proxy health stats
- `kv` — key/value store for cooldowns, counters and a TTL cache (expiry encoded in the value) for upstream API responses

Retention (`RETENTION_DAYS`) prunes old points and delivered alerts on a timer.

## Frontend

`web/` is a Vite + React + Tailwind SPA (Dashboard, Watchers, Radar, Settings). In production Fastify serves the built bundle from `dist/web`, so there is exactly one deployable.

## Observability

- `GET /health` — unauthenticated liveness (used by the Docker `HEALTHCHECK`)
- `GET /metrics` — Prometheus text format with `HELP` / `TYPE`
- log lines with secret redaction (`src/log.ts`, `util.redact`)

## Testing strategy

Vitest, 116 tests. The HTTP layer is tested against a real local server (redirect loops, 403 / 5xx / 404, oversized bodies) rather than mocks; adapters are tested against recorded fixtures in `fixtures/`; the API is tested through the Fastify app with a temporary on-disk SQLite database.
