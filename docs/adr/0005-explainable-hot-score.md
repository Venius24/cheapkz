# 0005 — Explainable weighted Hot Score

**Status:** Accepted

## Context
Users need a single "is this a good deal right now?" number, but they must be able to trust it. The data per watcher is small (tens to hundreds of price points), so ML would overfit and could not explain itself.

## Decision
Weighted sum of four bounded components, each in `[0, 1]`:

| Component | Weight | Meaning |
|---|---|---|
| `vsOld` | 0.35 | discount from the listed old price |
| `histPos` | 0.35 | share of own history that was more expensive (percentile) |
| `depth` | 0.20 | distance below the historical maximum |
| `fresh` | 0.10 | newly discovered offer |

Missing components are dropped and the remaining weights renormalised. Percentile and depth need ≥ 5 history points. Thresholds: ≥ 65 hot, ≥ 40 warm, otherwise cool. The two largest contributions are rendered as the human-readable reason in the alert.

## Consequences
- ✅ Deterministic, testable, explainable ("−22% from old price · cheaper than 91% of its history").
- ⚠️ Weights are hand-tuned. They are constants in one place, so they are easy to adjust once there is data to calibrate against.
