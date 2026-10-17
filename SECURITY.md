# Security Policy

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository
(<https://github.com/Venius24/cheapkz/security/advisories/new>). Do not open a public issue for security problems.

Include a description, reproduction steps and the affected version/commit. You can expect an initial response within a few days.

## Threat model in short

CheapKZ takes URLs from users (Telegram bot, REST API) and fetches them server-side, so the main concerns are:

- **SSRF** — every request and every redirect hop is checked against private, loopback, link-local and CGNAT ranges (`src/http/safeUrl.ts`). Disabled only by an explicit `ALLOW_PRIVATE_TARGETS=1`.
- **Secret leakage** — tokens in query strings and proxy credentials are redacted before errors reach logs, the DB or Telegram.
- **Admin auth** — Bearer token compared via SHA-256 + `timingSafeEqual`; production start-up refuses weak or example tokens.
- **Injection into bot messages** — all untrusted text is HTML-escaped, including quotes in attributes.

Known limitation: a theoretical DNS-rebinding window between the SSRF check and the connection (see [ADR 0004](docs/adr/0004-manual-redirects-ssrf.md)).
