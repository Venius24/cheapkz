# 0003 — Scoring and rules as pure functions

**Status:** Accepted

## Context
The alerting logic is the product. It must be easy to reason about, because bugs there either spam users or silently miss deals.

## Decision
`hotScore(input)` and `evaluateRules(ctx)` take plain data and return plain data — no DB, no network. Cooldowns, persistence and delivery are the caller's job (`runWatcher`, `Notifier`).

## Consequences
- ✅ Table-driven tests with no setup; edge cases (empty history, `null` prices, zero old price) are cheap to cover.
- ✅ The same functions can later power backtesting against stored history.
- ⚠️ Callers must assemble the context (history, previous price) — that cost is paid in `runWatcher`.
