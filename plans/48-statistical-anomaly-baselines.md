# 48 — Statistical Anomaly Baselines (replace static insight thresholds with per-cluster z-score/MAD baselines)

## Goal
Replace static insight thresholds (false positives) with per-host/per-metric statistical baselines fit over ~7 days (MAD/IQR outlier rejection, store mean+σ), flag anomalies by |z|>2 so detection adapts per cluster. Add an agent tool to explain a score. Fail-open: cold start falls back to current static thresholds.

## Current reality (audited)
Insights use static thresholds, firing false positives on clusters whose normal range differs. The insights engine already collects the metrics; this plan fits a distribution per host/metric and scores deviations. Pointers (confirm with `rg`, mark `(verify)`):
- `src/lib/insights/collectors.ts` — where static-threshold checks live; refactor numeric checks to call a shared `scoreAnomaly`. (verify)
- Insights engine entry / evaluation loop that runs collectors (+ any cron sampling metrics) — where baselines get read and refit. (verify)
- D1 store + migration pattern (`src/lib/conversation-store/d1-store.ts` + `db/…-migrations/`) — mirror for `anomaly_baselines`. (verify)
- Agent tools dir `src/lib/ai/agent/tools/` — add `explain_anomaly_score`. (verify)
- Historical metric source for fitting: `system.metric_log`/`system.asynchronous_metric_log` or chmonitor's retained samples — pick the one already available. (verify)

## Implement now (F — file-level)
### Store — `anomaly_baselines` (new migration) + `baseline-store.ts`
Columns: `host_id TEXT NOT NULL, metric TEXT NOT NULL, mean REAL NOT NULL, stddev REAL NOT NULL, median REAL, mad REAL, sample_count INTEGER NOT NULL, window_start INTEGER, fitted_at INTEGER NOT NULL, PRIMARY KEY (host_id, metric)`.
Helpers: `getBaseline(hostId, metric): Promise<Baseline|null>`, `upsertBaseline(b): Promise<void>`, `listBaselines(hostId): Promise<Baseline[]>`.
### Fitter — `src/lib/insights/statistical-baseline.ts` (new)
```ts
export interface Baseline { hostId: string; metric: string; mean: number; stddev: number; median: number; mad: number; sampleCount: number; windowStart: number; fittedAt: number }
export function fitBaseline(hostId: string, metric: string, samples: number[]): Baseline
export function scoreAnomaly(value: number, b: Baseline | null): AnomalyScore
```
- `fitBaseline`: (1) reject outliers before fitting — median + MAD; drop points with robust z = 0.6745*(x-median)/MAD > ~3.5 (IQR fence); then mean+σ on cleaned set. (2) guard degenerate: sampleCount < ~50 ⇒ low-confidence baseline; stddev==0 ⇒ avoid divide-by-zero.
- `scoreAnomaly`: z=(value-mean)/stddev; anomalous when |z|>2 (configurable); returns `{ z, isAnomaly, confidence, usedBaseline }`. `b==null` (cold start) ⇒ `usedBaseline:false` and caller falls back to static threshold (fail-open).
- Perf: fitting a host's metrics < 100 ms/host — O(n), sample-capped, fetch the window once (no per-point DB round-trips).
### Refit scheduling
Refit on a cadence (reuse existing insights/cron cadence; staleness check on `fittedAt`). Read metric window from the chosen source, `fitBaseline`, `upsertBaseline`. Read-only + cheap.
### Refactor collectors — `insights/collectors.ts`
For each numeric metric compared to a static constant: `const b = await getBaseline(host, metric); const s = scoreAnomaly(value, b);` — if `s.usedBaseline` flag on `s.isAnomaly` (attach z/confidence); else fall back to the existing static threshold. Keep finding shape/severity mapping compatible with downstream (alerting, weekly report). Non-numeric checks unchanged.
### Agent tool — `explain_anomaly_score` in `src/lib/ai/agent/tools/`
`explain_anomaly_score({ host, metric, value? })` → baseline (mean, σ, median, MAD, sample_count, fitted_at) + current value z-score + plain-English explanation. Read-only; applies nothing.
### Tests — `src/lib/insights/*.test.ts` (Bun)
- fitBaseline rejects injected outliers; stable mean/σ on synthetic normal sample.
- scoreAnomaly: |z|>2 flags; within band doesn't; b==null ⇒ usedBaseline:false.
- Cold-start fallback: collector with no baseline uses static threshold (no regression).
- FP reduction: a synthetic workload that trips the STATIC threshold but is within this cluster's normal range does NOT flag under baseline — assert FP count drops materially vs static.
- Fit perf: representative host metric set fits < 100 ms (loose timing / op-count proxy).

## STOP conditions & drift check
Drift first: `git diff --stat -- apps/dashboard/src/lib/insights`. STOP if: no historical metric source to fit from (report, don't invent sampling infra); refactor changes finding shape breaking downstream consumers; removing static thresholds would regress cold start (keep the fallback); work needs more than the listed files.

## Done criteria
- Per-host/metric baselines (mean+σ via MAD/IQR) fit over ~7 days, persisted, refit on cadence; fit < 100 ms/host.
- Collectors flag by |z|>2 when baseline exists; fall back to static thresholds at cold start (fail-open).
- FP rate drops materially on synthetic workload vs static.
- `explain_anomaly_score` returns baseline + z-score + explanation (read-only).
- Safety: detection only — never auto-applies DDL/action; scores labeled statistical.
- type-check, insights test, lint exit 0; no files outside scope.
