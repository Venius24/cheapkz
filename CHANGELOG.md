# Changelog

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Anomaly detector** (new «Детектор» tab): pick Krisha.kz districts on an interactive map (Almaty, Astana, Shymkent) or Kaspi categories; a periodic scan alerts in Telegram when a listing is ≥ N% cheaper per m² than similar-size flats of the same district, or when an item drops ≥ N% below its own median price. Broad Kaspi mode watches all popular categories for sharp drops only
- District heat map (median ₸/m²) with anomaly badges; anomaly feed with photos and «too cheap — check it» flags
- Architecture overview and ADRs in `docs/`
- English README (Russian version kept as `README.ru.md`), CONTRIBUTING, SECURITY, issue/PR templates
- Dependabot configuration and a Docker build job in CI

### Fixed
- Krisha parser matched no cards on the current markup (`div.a-card[data-id]`); it now also extracts area, rooms, rent period and address
- Opening the panel at `/` returned 403 instead of the SPA

## [1.0.0]

### Added
- Sources: Kaspi.kz, OLX.kz, Krisha.kz, flights (Travelpayouts) and a generic CSS-selector adapter
- Explainable Hot Score (0–100) and alert rules: target price, % drop, historical-low percentile, new matching listings
- Telegram bot (grammY) and REST API + React dashboard
- Anti-ban HTTP layer: per-host token bucket, jitter, proxy pool, circuit breaker
- SSRF guard with per-hop redirect validation, secret redaction, constant-time admin token check
- Prometheus metrics, SQLite persistence with retention, Docker image, 116 automated tests
