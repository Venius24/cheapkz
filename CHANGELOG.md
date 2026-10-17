# Changelog

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Architecture overview and ADRs in `docs/`
- English README (Russian version kept as `README.ru.md`), CONTRIBUTING, SECURITY, issue/PR templates
- Dependabot configuration and a Docker build job in CI

## [1.0.0]

### Added
- Sources: Kaspi.kz, OLX.kz, Krisha.kz, flights (Travelpayouts) and a generic CSS-selector adapter
- Explainable Hot Score (0–100) and alert rules: target price, % drop, historical-low percentile, new matching listings
- Telegram bot (grammY) and REST API + React dashboard
- Anti-ban HTTP layer: per-host token bucket, jitter, proxy pool, circuit breaker
- SSRF guard with per-hop redirect validation, secret redaction, constant-time admin token check
- Prometheus metrics, SQLite persistence with retention, Docker image, 116 automated tests
