# 39 — OTel trace export

## Kickoff prompt

```text
Execute plans/39-otel-trace-export.md ALONE (do not read other plans).
Goal: emit chmonitor's OWN query traces as OpenTelemetry spans and export them to
an external OTLP collector (Jaeger/Tempo/etc.), OPT-IN via CHM_OTEL_EXPORTER_URL.
Span tree per request: dashboard-request -> clickhouse-query -> system-table-read,
with query_id / user / read_bytes attributes; batch export; no measurable latency.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE / fail-open: export is OFF unless CHM_OTEL_EXPORTER_URL
  is set. Absent the env var, zero spans are exported and there is zero added latency.
  The feature must never require Clerk/billing.
- SSRF: CHM_OTEL_EXPORTER_URL is an operator-set collector endpoint (trusted, like a
  logging sink), NOT user-suppliable per-request — validate it's an absolute http(s)
  URL at startup. Do not derive the export target from request data.
- Honest claims: only attach attributes you actually populate.
- Postgres/multi-DB: NO.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/39, P2/M/F): chmonitor already **reads** OTel spans (the OTel span *viewer*
integration) but **cannot export its own** query traces to a collector for correlation. Per
strategy §1, exporting into a team's existing tracing stack is another "meet them where they
are" integration — and it makes chmonitor's query path observable alongside app traces.

Pointers (verify at head):
- ClickHouse query execution goes through `@chm/clickhouse-client` /
  `packages/clickhouse-client`; the dashboard's query routes call into it. Wrap the
  execution boundary there (or at the route handler) to create spans `(verify seam)`.
- Env schema/defaults module (where other `CHM_*` flags live) `(verify)` — add
  `CHM_OTEL_EXPORTER_URL`.
- Note: runs on Cloudflare Workers (workerd). Use an OTLP/HTTP exporter (not gRPC) and a
  batch processor compatible with the Workers runtime.

## Goal

When `CHM_OTEL_EXPORTER_URL` is set, chmonitor emits a span tree per query request
(`dashboard-request` → `clickhouse-query` → `system-table-read`) with `query_id`, `user`,
and `read_bytes` attributes, batch-exports over OTLP/HTTP to the collector, spans appear in
Jaeger/Tempo with durations matching real query time, and there is no measurable latency add
when the feature is off.

## Implement now (depth F — file-level)

### A. Exporter setup — `apps/dashboard/src/lib/otel/exporter.ts` (new)
- Dependency: `@opentelemetry/exporter-trace-otlp-http` + the SDK trace core (verify exact
  package names/versions against what's installable; the roadmap names
  `@opentelemetry/exporter-trace-http`).
- Initialize a `TracerProvider` **once**, guarded by `CHM_OTEL_EXPORTER_URL`:
  - If unset → export a no-op tracer (spans become cheap no-ops; **zero** network, **zero**
    added latency). This is the OSS/default path.
  - If set → configure an `OTLPTraceExporter({ url })` behind a `BatchSpanProcessor`
    (batch size + scheduled delay tuned so export never blocks the request path).
- Validate `CHM_OTEL_EXPORTER_URL` is an absolute http(s) URL at init; on invalid, log once
  and fall back to no-op (fail-open, don't crash).
- Resource attributes: `service.name = chmonitor`, version, deployment edition.

### B. Instrument the query path — wrap the execution seam
- Create spans around the request → query → system-table-read boundary. Prefer a small
  helper `withSpan(name, attrs, fn)` in `src/lib/otel/` used at:
  - the dashboard query route handler → `dashboard-request` (root span).
  - the `@chm/clickhouse-client` execution call → `clickhouse-query` (child).
  - the system-table read within a query → `system-table-read` (child) `(verify this seam
    is distinguishable; if not, collapse to two levels and note it)`.
- Attributes (only if actually available — honest claims): `query_id`, `user`/owner ref,
  `read_bytes` (from ClickHouse response stats), `host`, `duration_ms` (implicit in span).
- Ensure spans **end** in a `finally` so errors still close them; record exceptions on the
  span.

### C. Env gate + docs
- Add `CHM_OTEL_EXPORTER_URL` (optional) to the env schema/defaults `(verify module)` and
  document it in the self-host env docs as opt-in, with a Jaeger/Tempo example endpoint.
- Document the workerd constraint (OTLP/HTTP only).

## STOP conditions & drift check

- STOP if an OTel *export* pipeline already exists (vs. the span *viewer*) — reconcile, don't
  duplicate.
- STOP if the installable OTel exporter packages don't run under workerd — surface the
  blocker and propose the nearest Workers-compatible exporter rather than shipping something
  that no-ops silently in production.
- DRIFT: if wrapping the query path measurably adds latency when the feature is OFF, that
  violates the invariant — make the disabled path a true no-op (guard before span creation).
- Do NOT derive the collector URL from request data. Do NOT gate on Clerk/billing.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/otel --isolate
cd apps/dashboard && bun run lint
```

Targeted test (`src/lib/otel/exporter.test.ts`): with `CHM_OTEL_EXPORTER_URL` unset, assert
the tracer is a no-op (no exporter constructed); with it set to a fake URL, assert a
`BatchSpanProcessor`/exporter is configured and `withSpan` produces a span with the expected
name + attributes (use an in-memory span exporter to capture).

## Done criteria

- With `CHM_OTEL_EXPORTER_URL` set, the 3-level span tree exports over OTLP/HTTP and is
  visible in a collector; durations match query time.
- With it unset, zero spans export and there is no measurable added latency (no-op path).
- Attributes (`query_id`/`user`/`read_bytes`) populate only when available.
- OTel unit test passes; monorepo `bun run build` is green.

Priority: P2 · Effort: M · Depth: F · Wave: I (Integrations) · Lever: Adoption / Enterprise
