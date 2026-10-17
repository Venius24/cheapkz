# 0001 — SQLite via `node:sqlite`

**Status:** Accepted

## Context
The service is a single-tenant monitor: low write volume, one process, easy backups matter more than horizontal scale. Popular drivers (`better-sqlite3`, `sqlite3`) need native compilation, which breaks `npm install` on Windows without build tools and complicates slim Docker images.

## Decision
Use the built-in `node:sqlite` (`DatabaseSync`), wrapped by a small `DB` interface in `src/db/client.ts`. WAL mode, `foreign_keys=ON`, schema versioned by `PRAGMA user_version` with transactional migrations.

## Consequences
- ✅ Zero native dependencies; `npm ci` works everywhere; the image stays small.
- ✅ The wrapper interface means swapping the driver touches one file.
- ⚠️ Requires Node ≥ 23. The app cannot start on older versions; CI and Docker pin Node 24.
- ⚠️ The module is still flagged experimental, so its API may shift — the wrapper limits the blast radius.
