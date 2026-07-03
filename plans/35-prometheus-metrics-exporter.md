# 35 — Prometheus metrics exporter

## Goal
A cached, feature-gated `/metrics` endpoint returns valid Prometheus text (`# HELP`/`# TYPE` + samples), labeled by `host`, covering `system.metrics`, `system.asynchronous_metrics`, and chmonitor's own alert counters — scrapeable at 30s with no surprise query load, fail-open for OSS.

## Current reality (audited)
There is no `/metrics` endpoint. Pointers (verify at head):
- ClickHouse access: `packages/clickhouse-client` (`@chm/clickhouse-client`) — reuse the existing per-host query transport; already DNS-pinned/SSRF-guarded. Do NOT open a new socket.
- Alert counters: health/alerting subsystem under `apps/dashboard/src/lib/health/` (adapters, sweep, dedup state). Surface counts from the in-memory alert state / dedup store (verify exact module).
- Route convention: TanStack Start API routes under `apps/dashboard/src/routes/api/v1/`.

## Implement now (depth F — file-level)
### A. Endpoint — `apps/dashboard/src/routes/api/v1/metrics.ts` (verify final path)
- Serve at `/api/v1/metrics`; optionally add a top-level `/metrics` alias via a thin re-export route if the router allows (verify). Prometheus accepts any path, so `/api/v1/metrics` is acceptable.
- `GET`; `Content-Type: text/plain; version=0.0.4; charset=utf-8`.
- Feature gate: read `CHM_FEATURE_PROMETHEUS_ENABLED`. Default = on when self-hosted (no Clerk), off in cloud unless explicitly enabled. Resolve via the existing edition/self-host detection (verify helper); when disabled return `404` (not 403 — don't advertise the surface in cloud).
- Fail-open: never call a billing/plan gate. Owner/host resolution best-effort; if Clerk absent (OSS), enumerate configured host(s) from the stored connection source and emit for all.
### B. Exporter — `apps/dashboard/src/lib/metrics/prometheus-exporter.ts` (new)
- Query per host, in parallel: `SELECT metric, value FROM system.metrics` and `SELECT metric, value FROM system.asynchronous_metrics`.
- Emit one gauge per metric. Name = `clickhouse_` + snake_cased metric (lowercased, non-alnum → `_`). Escape label values per Prometheus rules (`\`, `"`, `\n`).
- Every sample carries `host="<hostId or label>"`. Add static `# HELP` (generic, honest) and `# TYPE <name> gauge` once per metric name (dedupe HELP/TYPE lines).
- chmonitor alert counters (append after CH metrics): `chmonitor_alerts_firing{host}` (current firing from alert state); `chmonitor_alerts_dispatched_total{host}` (from dedup/history store if a total is available, else omit — honest); `chmonitor_scrape_duration_seconds` (self-observed build time gauge).
### C. Cache — 30s TTL
- Module-level `{ builtAt: number; body: string }`. If `Date.now() - builtAt < 30_000` return cached; else rebuild. Guard concurrent rebuilds with a single in-flight promise so a scrape storm triggers ONE query set. (Workerd: module state is per-isolate; 30s TTL still an effective damper.) NOTE: `Date.now()` is fine in production runtime code; only workflow scripts forbid it.
### D. Env gate + docs
- Add `CHM_FEATURE_PROMETHEUS_ENABLED` to the env schema/defaults (verify env module) and document it in the self-host env docs. Note default-on-self-host / off-in-cloud.

## STOP conditions & drift check
- STOP if a `/metrics` (or equivalent Prometheus exporter) route already exists — reconcile.
- STOP if emitting alert counters requires a NEW persistence layer — emit only counters already available in memory/store; note the gap.
- DRIFT: if `@chm/clickhouse-client` exposes no way to run an ad-hoc SELECT against a host without a billing-gated path, STOP and surface the real entrypoint rather than adding a bypass.
- Do NOT introduce any new outbound fetch. Do NOT gate on plan/billing.

## Test — `src/lib/metrics/prometheus-exporter.test.ts` (new)
Feed a mocked `system.metrics` / `asynchronous_metrics` result set; assert the emitted text parses as valid Prometheus (`# HELP`/`# TYPE` present, unique per name, `host` label on every sample, values numeric).

## Done criteria
- `GET /api/v1/metrics` returns valid Prometheus text with `host` labels when enabled; `404` when the gate is off.
- Scrapes cached ~30s; concurrent scrapes trigger a single query batch.
- chmonitor alert counters emit from real state (or are honestly omitted).
- Exporter unit test passes; type-check + tsconfig.test typecheck + lint green.
