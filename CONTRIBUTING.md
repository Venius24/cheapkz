# Contributing to CheapKZ

Thanks for taking a look! Bug reports, new source adapters and small fixes are all welcome.

## Setup

Requires **Node.js ≥ 23** (the app uses the built-in `node:sqlite`).

```bash
git clone https://github.com/Venius24/cheapkz.git
cd cheapkz
npm install
cp .env.example .env
npm run dev          # API + bot + scheduler on http://localhost:8080
npm run dev:web      # optional: Vite dev server for the SPA
```

## Before you open a PR

```bash
npm run typecheck    # strict TS for server and web
npm test             # vitest
npm run build
```

CI runs the same three commands plus a Docker build.

## Adding a new source

1. Create `src/sources/<name>.ts` exporting an adapter that returns `Offer[]` (see `src/sources/types.ts`).
2. Fetch **only** through the provided `HttpGuard` — never call `fetch`/`undici` directly, so rate limits, proxies and SSRF checks apply ([ADR 0002](docs/adr/0002-single-egress-http-guard.md)).
3. Register it in `src/sources/index.ts`.
4. Save a trimmed real response in `fixtures/` and add parser tests in `tests/sources.test.ts`. No tests that hit live sites.

## Style

- TypeScript strict mode, ES modules, `.js` extensions in relative imports.
- Keep scoring and rule logic pure (no I/O) — see [ADR 0003](docs/adr/0003-pure-scoring-and-rules.md).
- Small, focused commits; imperative subject line (`fix: …`, `feat: …`, `docs: …`, `test: …`, `chore: …`).
- Never commit tokens, proxy credentials or `.env`.

## Reporting security issues

Please do not open a public issue — see [SECURITY.md](SECURITY.md).
