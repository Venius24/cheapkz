# 0004 — Manual redirects with per-hop SSRF checks

**Status:** Accepted

## Context
Watcher URLs are user input. A public URL can answer `302` with a `Location` of `http://169.254.169.254/` (cloud metadata) or `http://localhost:…`. Letting the HTTP client follow redirects silently bypasses any pre-flight check. Additionally, undici's `maxRedirections` does not work with a custom dispatcher such as `ProxyAgent`.

## Decision
Redirects are followed in a loop in `HttpGuard.fetchOnce` (max 4 hops). Every hop re-runs `assertPublicUrl()` — scheme allow-list, DNS resolution, rejection of private, loopback, link-local, CGNAT and multicast ranges (IPv4 and IPv6, including IPv4-mapped). One overall deadline covers all hops.

## Consequences
- ✅ Closes the redirect-based SSRF path and makes redirects work through proxies.
- ⚠️ DNS is resolved by the guard and again by the connection, leaving a theoretical DNS-rebinding window. Pinning the resolved IP to the connection is a possible future hardening.
- `ALLOW_PRIVATE_TARGETS=1` is an explicit opt-out for monitoring internal services.
