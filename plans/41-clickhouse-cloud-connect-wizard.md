# 41 — ClickHouse Cloud connect wizard

## Kickoff prompt

```text
Execute plans/41-clickhouse-cloud-connect-wizard.md ALONE (do not read other plans).
Goal: add a ClickHouse Cloud connection preset to the add-host flow — TLS on, port
8443, service-hostname hints, first-try connect — plus an OPTIONAL Cloud cost sync
that populates a cost-aware card. Give Cloud users a clear onboarding path distinct
from self-host.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE / fail-open: the Cloud preset is additive UI; the
  existing self-host/Docker/K8s connect paths are untouched and remain the default.
  Nothing here requires Clerk/billing. The optional cost sync is off unless configured.
- SSRF: connecting to a user-supplied ClickHouse host already flows through the
  existing DNS-pinned/SSRF-guarded connection path — REUSE it; do not add a new
  unguarded fetch. If the optional Cloud billing sync calls a ClickHouse Cloud API,
  route it through the existing SSRF guard and validate the endpoint.
- Honest claims: the cost card only shows data the sync actually retrieves.
- Postgres/multi-DB: NO. ClickHouse-only.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/41, P1/M/F): there is **no Cloud-vs-self-host onboarding path** — a new user
must hand-configure TLS/port/hostname for a ClickHouse Cloud service. ClickHouse Cloud users
are a **prime paying segment** (strategy §1: the advisor+alerting work on *every* deployment,
incl. Cloud). A one-click Cloud preset with correct TLS defaults removes first-run friction
for the segment most likely to convert.

Pointers (verify at head):
- Add-host UI: `apps/dashboard/src/components/connections/add-host-dialog.tsx` (confirmed to
  exist) — this is where the preset toggle + field hints live.
- Connection creation + validation route:
  `apps/dashboard/src/routes/api/v1/user-connections.ts` (verify) — already SSRF/DNS-guarded;
  reuse for the Cloud test-connect.
- Optional cost sync (new): `apps/dashboard/src/lib/ch-cloud/billing-sync.ts` (new) — only if
  a Cloud billing/usage source is available.

## Goal

The add-host dialog offers a "ClickHouse Cloud" preset that pre-fills TLS-on, port 8443, and
service-hostname hints so a Cloud service connects on the first try; validation confirms
reachability through the existing guarded path; and an **optional** Cloud cost sync populates
a cost-aware card used by cost-aware alerts. Self-host paths are unchanged.

## Implement now (depth F — file-level)

### A. Cloud preset in the dialog — `components/connections/add-host-dialog.tsx`
- Add a connection-type selector (or preset button): **Self-hosted** (default, current
  behavior) vs. **ClickHouse Cloud**.
- When "ClickHouse Cloud" is chosen, apply these **TLS presets** to the form defaults:
  - `secure = true` (TLS/HTTPS on) — non-negotiable for Cloud.
  - `port = 8443` (HTTPS native/interface port; verify the app's port field semantics — HTTP
    interface vs. native — and set the correct Cloud default, 8443 for HTTPS).
  - Hostname hint/placeholder for the Cloud service pattern (e.g.
    `<service-id>.<region>.<cloud>.clickhouse.cloud`) with helper text: "Paste your Cloud
    service hostname; username is usually `default`."
  - Disable/hide the "allow insecure" affordance for the Cloud preset (Cloud requires TLS).
- Keep all existing self-host fields and behavior intact when the self-host preset is active.

### B. Validation — reuse the guarded connect path
- On "Test / Add", call the existing `user-connections` create/validate route (verify path)
  **unchanged** so the connection still flows through DNS-pinning/SSRF guard. Surface a
  Cloud-specific error hint if the failure looks like a TLS/port mismatch (e.g. "ClickHouse
  Cloud requires TLS on port 8443").
- Do NOT special-case the network path to bypass the guard — only the *defaults* and *hints*
  differ for Cloud.

### C. Optional Cloud cost sync — `src/lib/ch-cloud/billing-sync.ts` (new)
- Gate behind explicit configuration (env/flag; off by default — fail-open, OSS untouched).
- If enabled and credentials present, fetch usage/cost from the ClickHouse Cloud API through
  the existing SSRF-guarded fetch, cache it, and expose it to a cost card used by cost-aware
  alerts. Validate the API endpoint URL.
- If disabled or unauthenticated: the cost card is simply absent — **honest claims** (no
  placeholder numbers).

### D. Docs
- Document the Cloud preset (TLS/8443/hostname) and the optional cost sync
  (env + what it populates) in the connect/onboarding docs.

## STOP conditions & drift check

- STOP if a Cloud preset already exists in the dialog — reconcile, don't duplicate.
- STOP if adding the cost sync would require an unguarded outbound fetch — defer the sync and
  ship the preset alone rather than bypassing the SSRF guard.
- DRIFT: verify the port-field semantics before hardcoding 8443 — if the field is the native
  secure port (9440) vs. HTTPS interface (8443), set the value that matches how the app's
  client actually connects. Do not guess; `(verify)` against `@chm/clickhouse-client`.
- Do NOT alter the self-host default path. Do NOT gate the preset behind Clerk/billing.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/components/connections --isolate
cd apps/dashboard && bun run lint
```

Targeted test: assert selecting the ClickHouse Cloud preset sets `secure=true` + the correct
Cloud port + the hostname placeholder, and that the self-host preset leaves current defaults
unchanged. If a cost-sync module is added, add
`src/lib/ch-cloud/billing-sync.test.ts` asserting it is a no-op when unconfigured.

## Done criteria

- The add-host dialog offers a ClickHouse Cloud preset with TLS-on + correct port +
  hostname hints; a Cloud service connects on the first try through the existing guarded path.
- Self-host connect behavior is unchanged and remains the default.
- Optional Cloud cost sync (when configured) populates a cost card via the SSRF-guarded
  fetch; absent config, no card and no fake data.
- Preset test passes; monorepo `bun run build` is green.

Priority: P1 · Effort: M · Depth: F · Wave: I (Integrations) · Lever: Revenue / Adoption
