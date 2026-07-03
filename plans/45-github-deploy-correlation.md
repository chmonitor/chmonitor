# 45 — GitHub Deploy Correlation (ingest deployment webhooks, overlay deploy markers on the query-volume timeline)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`. This is an **epic-brief (E)**: do the discovery in
> "Open questions" *before* writing code, then implement.

## Kickoff prompt

```text
Execute plans/45-github-deploy-correlation.md ALONE (Wave I, integrations).
Goal: ingest GitHub deployment webhooks, store repo/env/version/timestamp in D1,
and overlay deploy markers on the query-volume timeline so SREs can correlate query
spikes / replication lag with releases. Invariants you MUST hold:
- Self-hosted/OSS stays whole; feature fails open — no webhook configured ⇒ no
  markers, no behavior change.
- SSRF is inbound here, so the control is INBOUND AUTH: verify the GitHub webhook
  HMAC signature (X-Hub-Signature-256) and reject unsigned/mismatched payloads.
- Honest claims: markers reflect only verified, stored deployments.
- Recommend/observe only — this feature never triggers or changes deployments.
- Postgres/multi-DB: NO new backend beyond the existing D1 store pattern.
This is depth E: FIRST resolve the open questions (which timeline chart, how deploys
map to a host/org, secret storage) against the live repo, then build:
new routes/api/v1/webhooks/github.ts, D1 table github_deployments, a timeline
overlay in the query-history charts. End by running:
cd apps/dashboard && bun run type-check && bun run build &&
bun test src/lib/deployments --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §2 and §4 spec 45: correlating query spikes / lag with releases is
high-value SRE context that chmonitor doesn't offer yet. The building blocks exist —
signature-verified webhooks (the Polar and Clerk webhook handlers already do HMAC/verify),
a D1 store pattern, and query-history/volume charts — so this is assembly + a chart overlay,
not new infra.

Pointers (confirm with `rg`, mark `(verify)`):
- Existing verified webhook handlers to mirror for signature checking:
  `routes/api/v1/webhooks/polar.ts` (signature + idempotency) and `…/clerk.ts`
  (`verifyWebhook`). Copy the verify-then-act shape. (verify)
- D1 store + migration pattern: `src/lib/conversation-store/d1-store.ts` +
  `db/…-migrations/`. Mirror for `github_deployments`. (verify)
- Query-volume / query-history timeline chart component(s) under
  `components/charts/…` or the query-history route — the overlay target. **Identify the
  exact chart before coding** (see Open questions). (verify)

## Goal

GitHub POSTs deployment (or deployment_status) events → chmonitor verifies the signature,
stores `{repo, environment, version/ref, sha, created_at}` in D1 → the query-volume
timeline renders vertical deploy markers (hover shows repo/env/version) and offers a
"filter to this deploy window" affordance; a small API lists recent deployments.

## Implement now (E — approach + key files + open questions)

### Approach

1. **Ingest** `routes/api/v1/webhooks/github.ts` (new, `POST`):
   - Read the raw body; compute `HMAC_SHA256(secret, rawBody)`; compare in constant time
     to the `X-Hub-Signature-256` header (`sha256=` prefix). Reject (401) on
     missing/mismatch — mirror the Polar/Clerk verify path exactly. Secret from env
     `GITHUB_WEBHOOK_SECRET`.
   - Handle the `deployment` and/or `deployment_status` events (ignore others with 204).
     Extract `repository.full_name`, `deployment.environment`,
     `deployment.ref`/`payload.version`, `deployment.sha`, `created_at`.
   - Idempotency: dedupe on GitHub's `deployment.id` (unique) so redeliveries don't
     double-insert — mirror the Polar idempotency guard.
   - `upsert` into `github_deployments`.

2. **Store** — D1 migration `github_deployments`:
   `id TEXT PK /* github deployment id */, owner_scope TEXT /* org/user or host mapping */,
   repo TEXT NOT NULL, environment TEXT, ref TEXT, sha TEXT, version TEXT,
   created_at INTEGER NOT NULL, received_at INTEGER NOT NULL` (index on
   `owner_scope, created_at`).

3. **Read API** — a `GET` (in the same route file or `routes/api/v1/deployments.ts`)
   returning recent deployments filtered by time range + scope, for the chart overlay.

4. **Overlay** — in the identified query-volume timeline chart: fetch deployments for the
   visible time range and render vertical reference lines/markers at each `created_at`
   (hover tooltip: repo · env · version/sha). Add a "filter to deploy window" control
   that sets the chart's time range to [deploy, deploy+N min] (reuse the chart's existing
   time-range mechanism — do not build a new one).

### Open questions (resolve against the live repo BEFORE coding)

- **Which chart is "the query-volume timeline"?** Find the concrete component that plots
  query volume over time (likely a factory chart on the query-history page). The overlay
  must attach to *that* chart's axis/time-range, not a new canvas. Name it in the plan
  before editing. (verify)
- **How does a GitHub deployment map to a chmonitor scope?** Options: (a) a global/env
  marker shown on every timeline; (b) map `repository`/`environment` → an owner/org or a
  specific host via a small config. Pick the simplest that's honest — likely per-owner
  (`owner_scope`) with all repos shown, and refine later. Decide and record.
- **Secret storage & multi-tenant:** is `GITHUB_WEBHOOK_SECRET` a single server secret
  (self-host / single-org) or per-org? For this plan use a single env secret (fail-open,
  self-host-first); note per-org as a follow-up if Clerk orgs each need their own.
- **Chart lib overlay API:** does the charting lib (recharts/xyflow/etc.) support
  reference lines out of the box, or does the overlay need a sibling SVG layer? Confirm
  and use the native mechanism if present.

### Tests — `src/lib/deployments/*.test.ts` (Bun)

- Signature verify: a correctly-signed body is accepted; a tampered body / wrong secret
  is rejected (401); missing signature rejected.
- Idempotency: the same `deployment.id` delivered twice inserts once.
- Store read returns deployments within a time-range filter (used by the overlay).

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/routes/api/v1/webhooks apps/dashboard/src/components/charts` — reconcile pointers if these changed.

STOP and report if:
- You cannot identify a single concrete query-volume timeline chart to overlay onto
  (the E-plan's core open question) — report options rather than guessing wrong.
- The webhook cannot be signature-verified with an available HMAC helper (do not accept
  unsigned GitHub payloads — that's the inbound-auth invariant).
- Correlating deployments to a host/scope requires schema or auth changes beyond the
  listed files — report the scope creep.

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/deployments --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] GitHub deployment webhooks are **signature-verified** and stored (idempotently) in
      `github_deployments`; unsigned/mismatched payloads are rejected 401.
- [ ] The identified query-volume timeline renders deploy markers with hover detail and a
      filter-to-deploy-window control; with no deployments the chart is unchanged.
- [ ] A read API lists recent deployments by time range for the overlay.
- [ ] **Safety**: the feature is observe-only — it never triggers, changes, or rolls back
      a deployment, applies no DDL, and does not alter any query plan; fails open when no
      webhook is configured.
- [ ] `type-check`, `build`, `bun test src/lib/deployments --isolate`, `lint` all exit 0.
- [ ] No files outside scope modified; `plans/README.md` row updated.

---

Priority **P2** · Effort **M** · Depth **E** · Wave **I** · Lever **Adoption/Ecosystem**
