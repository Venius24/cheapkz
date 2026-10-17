# Architecture Decision Records

Short records of the non-obvious choices in this codebase: context, the decision, and what it costs us.

| # | Decision | Status |
|---|---|---|
| [0001](0001-sqlite-node-builtin.md) | SQLite via `node:sqlite` instead of a native driver | Accepted |
| [0002](0002-single-egress-http-guard.md) | One outbound gateway (`HttpGuard`) for every adapter | Accepted |
| [0003](0003-pure-scoring-and-rules.md) | Scoring and alert rules as pure functions | Accepted |
| [0004](0004-manual-redirects-ssrf.md) | Follow redirects manually and re-check SSRF on every hop | Accepted |
| [0005](0005-explainable-hot-score.md) | Explainable weighted Hot Score instead of ML | Accepted |
