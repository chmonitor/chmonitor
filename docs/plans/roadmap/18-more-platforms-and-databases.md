# 18 — More Platforms & Databases

> Priority: P2 · Effort: L · Risk: MED · Depends on: none
> Category: Reach · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

chmonitor should be easy to run **everywhere ClickHouse runs**, but the deploy
story is uneven and the multi-database question keeps re-litigating itself:

- **First-class, CI-verified:** Cloudflare Workers (`cf:deploy`, `cloudflare.yml`),
  Docker image (`ghcr.io/chmonitor/chmonitor`, `release.yml`), Helm chart
  (`deploy/helm/chmonitor`, `helm-release.yml`, `k8s-lint.yml`).
- **Templates only, explicitly _not boot-verified_:** Railway
  (`deploy/templates/railway.json`), Render (`deploy/templates/render.yaml` — "not
  yet boot-verified in CI"), Fly (`deploy/templates/fly.toml` — "Not yet
  boot-verified in CI; verify before relying on it"). These point at the GHCR
  image and a `node server/index.mjs` start command + `/api/healthz` healthcheck,
  but nothing proves they actually boot.
- **Multi-DB temptation:** the CH client is pluggable-ish
  (`@chm/clickhouse-client` wraps `@clickhouse/client` + `-web`), and there's
  recurring pull to "just add Postgres." Doing so now would dilute the wedge.

This plan does two things: (1) make the one-click deploy targets actually work +
verify Helm, and (2) **record the Postgres/multi-DB decision as an ADR** so it
stops being re-argued — deferred with an explicit trigger, not hand-waved.

## Goal

**Every advertised deploy target (Railway, Render, Fly, Helm, Docker) is
boot-verified by an automated smoke test that hits `/api/healthz` on a booted
container, and the Postgres/multi-DB decision is recorded as an accepted ADR with
a concrete revisit trigger.** (One measurable outcome: a CI job boots the release
image the templates reference and fails if `/api/healthz` is not `200`.)

## Design

### 1. Boot-verify the container the templates all share

Railway/Render/Fly all deploy the **same** `ghcr.io/chmonitor/chmonitor` image
with `node server/index.mjs` + `/api/healthz`. So the highest-leverage guarantee
is a single **container smoke test** of that image + start command, plus a static
lint of each template file.

- New workflow `.github/workflows/deploy-smoke.yml`:
  1. Build (or pull on release) the Docker image.
  2. `docker run` it with a **mock/stub `CLICKHOUSE_HOST`** (or
     `CHM_ALLOW_PRIVATE_HOSTS`-style test config) and the same `PORT=3000` /
     `HOST=0.0.0.0` the templates set.
  3. Poll `GET /api/healthz` until `200` or timeout → fail if it never comes up.
     This is exactly the healthcheck the templates rely on, so a green smoke test
     means the templates' boot contract holds.
- **Template lint:** `scripts/validate-deploy-templates.ts` parses
  `railway.json` / `render.yaml` / `fly.toml` and asserts each references the
  correct image, `startCommand`/`internal_port`, `healthCheckPath =
  /api/healthz`, and the required `CLICKHOUSE_*` env keys. Drift (e.g. someone
  renames the health route) fails CI.
- Once green, delete the "not yet boot-verified in CI" caveats from the three
  template files and the deploy docs.

### 2. Verify Helm beyond lint

`k8s-lint.yml` lints; add a **render + boot** check: `helm template` the chart with
default values, `kubectl apply --dry-run=server` (or `kind` create + wait for the
Deployment to become Ready against the stub image) and probe the Service's
`/api/healthz`. Prove the chart actually schedules a healthy pod, not just that it
lints.

### 3. Keep the ClickHouse client architecturally pluggable (cheap insurance)

**Do not add another DB.** Do make sure adding one later is a client-boundary
change, not a rewrite:

- Add a `depcruise` rule asserting DB-driver imports (`@clickhouse/client*`) are
  confined to `packages/clickhouse-client` — app/API code must go through
  `@chm/clickhouse-client`, never import a driver directly. This is the seam that
  a future Postgres client would slot into.
- Document the seam in `packages/clickhouse-client/README.md`: the client is the
  single place a datasource lives; the rest of the app depends on the interface.

### 4. ADR: Postgres / multi-database support — DEFERRED

Record as `docs/adr/0001-no-multi-database-2026-h2.md` (create `docs/adr/` if
absent) in standard ADR form:

> **# ADR 0001 — No multi-database (Postgres) support in 2026 H2**
>
> **Status:** Accepted (2026-07-02).
>
> **Context.** ClickHouse depth is the wedge and the acquisition-fit thesis
> ("pganalyze for ClickHouse … an ops AI agent ClickHouse Cloud structurally
> won't build for self-hosters"). The CH client is pluggable enough that Postgres
> is _technically_ approachable, and there is recurring internal + prospect pull
> to add it. But every hour spent on a second engine is an hour not spent
> deepening the ClickHouse moat (advisor engine #21, ops agent #10, MCP #11) that
> makes chmonitor the obvious pick — and the obvious buy. pganalyze won Postgres
> by going _deep_, not wide. Going multi-DB now would make us a shallow
> general-purpose monitor competing with Datadog/Grafana on their turf, with no
> wedge and no acquisition story.
>
> **Decision.** **No Postgres / multi-database implementation in 2026 H2.** Focus
> reach on running the _ClickHouse_ product on more platforms (this plan §1–2).
> Keep the datasource boundary clean (§3) so the door isn't nailed shut — but
> ship nothing behind it now.
>
> **Consequences.**
> - (+) Engineering stays concentrated on the wedge; the acquisition thesis stays
>   coherent; marketing message stays sharp ("everywhere ClickHouse runs").
> - (+) No test/support/docs surface-area explosion from a second engine.
> - (−) We say "no" to prospects who want one tool for CH + Postgres; we lose
>   those specific deals now.
> - (−) The clean boundary (§3) costs a little discipline (the depcruise rule).
>
> **Revisit trigger (explicit).** Re-open this ADR **only** when at least one of:
> (a) **≥ $10k MRR** from the ClickHouse product (the wedge is proven and funded),
> **or** (b) a **concrete paying design-partner** commits to a multi-DB deal
> (a real pull, not a survey wish). Absent a trigger, "add Postgres" requests are
> closed as `wontfix — see ADR 0001`. Anything short of the trigger does **not**
> reopen this.

Link the ADR from `plans/roadmap/00-vision-and-strategy.md` and this plan.

## Steps

1. **(M)** `deploy-smoke.yml`: boot the GHCR image with stub CH config, poll
   `/api/healthz` for `200`, fail on timeout.
2. **(M)** `scripts/validate-deploy-templates.ts` + a `test.yml`/`k8s-lint.yml`
   step: assert Railway/Render/Fly reference the right image, ports, health path,
   and CH env keys. *Split:* (2a) parser+asserts for the 3 templates; (2b) wire
   into CI + delete "not boot-verified" caveats once green.
3. **(M)** Extend Helm CI: `helm template` + `kind`/dry-run apply + Service
   `/api/healthz` probe against the stub image.
4. **(S)** Add the `depcruise` rule confining `@clickhouse/client*` imports to
   `packages/clickhouse-client`; document the datasource seam in its README.
5. **(S)** Write `docs/adr/0001-no-multi-database-2026-h2.md` (form above); link
   it from the strategy doc and this plan.

## Real test

Fails today, passes after:

1. **Boot smoke (CI):** `deploy-smoke.yml` fails when `/api/healthz` never returns
   `200` from the booted image. Prove locally: run the image with a deliberately
   broken start command → the poll step exits non-zero; with the correct
   `node server/index.mjs` → `200`. Today nothing boots the image in CI.
2. **Template contract (unit):** `validate-deploy-templates.test.ts` — mutate a
   fixture template's `healthCheckPath` to `/wrong` → assertion fails; the real
   templates pass. Fails today (no validator).
3. **Datasource boundary (depcruise):** add a fixture module under `apps/` that
   imports `@clickhouse/client` directly → `bun run depcruise` errors; removing it
   passes. Fails today (no such rule).

## Verification

```
# template contract + boundary
cd apps/dashboard && bun test scripts/__tests__/validate-deploy-templates.test.ts
bun run depcruise

# container smoke (local repro of the CI gate)
docker build -t chmonitor:smoke .
docker run -d -p 3000:3000 -e CLICKHOUSE_HOST=http://stub:8123 -e PORT=3000 -e HOST=0.0.0.0 chmonitor:smoke
curl -fsS --retry 20 --retry-delay 2 http://localhost:3000/api/healthz

# helm renders + schedules a healthy pod
helm template deploy/helm/chmonitor | kubectl apply --dry-run=server -f -

# nothing regressed
bun run lint && bun run build && bun run test:unit
```

## Out of scope / STOP conditions

- **No Postgres / multi-database implementation now.** This plan writes the ADR
  that _defers_ it behind the $10k-MRR-or-paying-design-partner trigger; it does
  not write a line of Postgres code, schema, or driver. Requests to add it are
  closed as `wontfix — see ADR 0001` unless the trigger fires.
- **Self-hosted stays whole.** Deploy verification must not add any cloud-only
  requirement to the self-host path; the smoke test uses a stub CH, never a real
  cluster, and adds **no query load** to any user's ClickHouse.
- Do not add new deploy targets (Heroku, ECS, etc.) in this plan — verify the ones
  already advertised (Railway/Render/Fly/Helm/Docker) first.
- Keep the datasource boundary a _lint_, not a premature abstraction rewrite — the
  goal is "not nailed shut," not "second engine half-built."

## Done

- [ ] `deploy-smoke.yml` boots the release image and gates on `/api/healthz`.
- [ ] `validate-deploy-templates` test green; "not boot-verified" caveats removed
      from Railway/Render/Fly template files + docs.
- [ ] Helm CI renders + schedules a healthy pod (beyond lint).
- [ ] `depcruise` rule confines `@clickhouse/client*` to
      `packages/clickhouse-client`; seam documented in its README.
- [ ] `docs/adr/0001-no-multi-database-2026-h2.md` written (Context / Decision /
      Consequences / Revisit trigger) and linked from the strategy doc.
- [ ] `bun run lint && bun run build && bun run test:unit && bun run depcruise`
      green.
- [ ] Deploy docs updated to reflect verified targets.
- [ ] Flip the status row for **#18** in `plans/roadmap/README.md` to `DONE`
      (or `IN REVIEW`).
