# 0002 — Single egress point (`HttpGuard`)

**Status:** Accepted

## Context
Scraping retail sites gets IPs banned. Politeness (rate limits, jitter), resilience (proxies, retries, circuit breaking) and safety (SSRF) are cross-cutting; if each adapter implements them, one eventually forgets.

## Decision
Adapters receive an `HttpGuard` and have no other way to reach the network. The guard composes SSRF check → breaker → per-host token bucket → proxy selection → body cap → block detection.

## Consequences
- ✅ A new source gets all protections for free.
- ✅ One place to test, and one place to expose metrics (`requestsTotal`, `blockedTotal`, breaker state).
- ⚠️ The guard is a bigger class than ideal; the layers are kept as separate small classes (`RateLimiter`, `Breaker`, `ProxyPool`) to compensate.
