# 38 — Grafana datasource plugin

## Kickoff prompt

```text
Execute plans/38-grafana-datasource-plugin.md ALONE (do not read other plans).
Goal: build an OFFICIAL Grafana datasource plugin (NEW top-level package
apps/grafana-plugin/) that wraps chmonitor's ClickHouse query API and ships
ClickHouse-specific alert-rule templates + advisor panel templates — the thing a
generic ClickHouse datasource does NOT give you.

This plan BOOTSTRAPS A NEW PACKAGE with its OWN build/test (Grafana plugin
scaffold: `npm run build` / plugin sign/validate). It must NOT be added to the
monorepo `bun run build` graph in a way that breaks it.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE / fail-open: the plugin talks to a chmonitor instance
  over its existing HTTP API using a chmonitor API key; it must work against a
  self-hosted instance and must not require chmonitor Cloud. Enterprise-only panels
  are edition-gated on the chmonitor side, degrading gracefully if absent.
- SSRF: the plugin's backend makes outbound calls to the user-configured chmonitor
  base URL only; validate it's an absolute http(s) URL. No chmonitor-side change adds
  a new unguarded outbound fetch.
- Honest claims: ship only panel/alert templates backed by real chmonitor endpoints.
- Postgres/multi-DB: NO.

External setup: Grafana plugin SDK toolchain (create-plugin scaffold, Mage/Go for
the backend datasource, a signing/registry step for publish). Document it.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/38, P1/L/E): today the Grafana story is a **copy-paste recipe** only.
Grafana + the Altinity plugin (16.6M downloads) already own generic ClickHouse dashboards
(strategy §1) — so a chmonitor plugin must **not** compete on raw metrics. It differentiates
by shipping **ClickHouse-aware alert-rule templates + advisor panels** (projections,
skip-indexes, replication lag, part counts) that a generic datasource can't express.

Pointers (verify at head):
- chmonitor query API: `apps/dashboard/src/routes/api/v1/clickhouse/query` (verify exact
  path) — the plugin's datasource backend calls this with a `chm_` API key.
- API-key auth path already exists for programmatic access `(verify the key middleware)` —
  reuse it; do not invent a new auth scheme.
- `apps/grafana-plugin/` does **NOT** exist yet — this plan creates it as a NEW top-level
  package outside the Workers app.
- Edition gating: `apps/dashboard/src/lib/edition/` — enterprise panels/queries are gated
  there; the plugin must degrade if an endpoint 402/403s.

## Goal

An installable Grafana datasource plugin (via `grafana-cli` / a published tarball) that
queries a chmonitor instance, exposes template variables, ships ~10 prebuilt
ClickHouse-specific alert/advisor panels, imports as a dashboard in < 10 min, and is
marketplace-ready — with enterprise features edition-gated on the chmonitor side and
graceful degradation otherwise.

## Implement now (depth E — approach + key files + open questions + external setup)

### Approach
1. **Scaffold** the plugin in `apps/grafana-plugin/` with the Grafana `create-plugin`
   toolchain: a **frontend** (datasource config editor + query editor, TS/React) and a
   **backend** datasource (Go, via Mage) that proxies queries to the chmonitor API. A
   backend datasource is required for alerting support.
2. **Datasource config** — base URL + chmonitor API key (`chm_…`), secured as a Grafana
   secret. Validate the URL is absolute http(s).
3. **Query path** — the Go backend forwards the panel's ClickHouse query to
   `/api/v1/clickhouse/query`, maps the JSON result into Grafana data frames, and supports
   template variables (host, database, table) via a variables query.
4. **Bundled templates** — ship ~10 ClickHouse panels + alert rules as provisioning
   JSON/YAML (replication lag, readonly replicas, part counts, merges in progress, slow
   queries, disk usage, mutations stuck, and advisor-flavored panels tied to chmonitor
   endpoints). Enterprise/advisor panels call endpoints that may be edition-gated; on
   402/403 the panel shows an honest "requires chmonitor Enterprise" note rather than
   erroring.
5. **Publish** — build a signed tarball; document `grafana-cli plugins install` from a local
   tarball and the marketplace-submission checklist.

### Key files (new package)
- `apps/grafana-plugin/src/` — `plugin.json`, `datasource.ts`, `ConfigEditor.tsx`,
  `QueryEditor.tsx`.
- `apps/grafana-plugin/pkg/` — Go backend datasource (`main.go`, query handler, frame
  mapping), `Magefile.go`.
- `apps/grafana-plugin/provisioning/` — bundled dashboards + alert-rule templates.
- `apps/grafana-plugin/package.json` + `go.mod` — **its own** build/test scripts.
- README with install + setup (< 10 min) instructions.
- chmonitor side: confirm/adjust the API-key middleware allows the query endpoint; no new
  outbound fetch is added.

### Open questions
- Exact chmonitor query endpoint contract (request/response JSON) the backend must map to
  Grafana frames — capture it precisely before writing the Go mapper `(verify)`.
- Which of the 10 panels require enterprise endpoints vs. OSS endpoints — label each so free
  users get a working subset.
- Grafana plugin **signing**: unsigned plugins need `allow_loading_unsigned_plugins`;
  marketplace requires signing. Document both paths.

### External setup (document; do not assume)
- Install Grafana plugin toolchain: `npx @grafana/create-plugin`, Go + Mage for the backend.
- Build: frontend `npm run build`; backend `mage -v build:linux` (+ other targets).
- Sign + package for the catalog; provide a chmonitor API key with read scope.

### Monorepo boundary (critical)
- Add `apps/grafana-plugin/` as a package the monorepo **ignores for `bun run build`** (it is
  Go + Grafana-toolchain, not Vite). Ensure workspace globs / turbo (if any) don't try to
  `bun build` it. Verify `bun run build` at the repo root is unaffected.

## STOP conditions & drift check

- STOP if the chmonitor query endpoint or API-key auth path can't be located — the plugin is
  useless without them; surface the real contract first.
- STOP if scaffolding pulls the new package into the root `bun run build` and breaks it —
  isolate it before proceeding.
- DRIFT: do not embed chmonitor Cloud assumptions; the plugin must point at any base URL.
- Do NOT ship panels for endpoints that don't exist (honest claims).

## Verification

```
# monorepo must stay green (the new package must not join the bun build graph):
bun run build            # repo root — unaffected by apps/grafana-plugin
cd apps/dashboard && bun run type-check   # if the API-key/query route was touched

# the NEW package builds/tests on its own toolchain:
cd apps/grafana-plugin && npm ci && npm run build   # frontend
cd apps/grafana-plugin && mage -v test              # backend datasource (Go)
```

## Done criteria

- `apps/grafana-plugin/` scaffolds, builds (frontend `npm run build` + backend Mage), and
  installs into Grafana via a tarball; setup is < 10 min.
- Queries render against a self-hosted chmonitor instance using a `chm_` API key.
- ~10 ClickHouse alert/advisor panel templates import; enterprise panels degrade gracefully
  when the endpoint is gated.
- Root `bun run build` is unaffected; new-package build/test pass.

Priority: P1 · Effort: L · Depth: E · Wave: I (Integrations) · Lever: Adoption / Ecosystem
