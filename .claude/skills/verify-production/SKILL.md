---
name: verify-production
description: >-
  Prove the deployed chmonitor product actually works, not just that the
  Worker answers. Use after every deploy to dash.chmonitor.dev (or a preview),
  when triaging "no data" / "blank overview" / "agent does not answer", when a
  CI deploy was green but production looks broken, and when deciding whether to
  revert or roll back. Covers the verify-deploy contract, what the health
  endpoints do and do not prove, the agent/guest-model probes, usage and quota
  watch, and the restore-service order (revert PR first, wrangler rollback only
  as an opt-in emergency). Triggers: "verify deploy", "production is down",
  "deploy looks green", "revert", "rollback", "wrangler rollback", "agent not
  responding", "guest AI", "model unavailable", "usage", "quota", "no data in
  production", "downtime".
---

# Verify production

The dashboard deploys itself: `.github/workflows/cloudflare.yml` builds, ships,
and runs `bun scripts/verify-deploy.ts` on every push to `main`. So CI proves
the deploy path. It does **not** prove the product works, because the checks CI
runs stop at "the endpoints answered".

This skill is the knowledge for the second pair of eyes: what to probe, what a
green probe actually means, and what to do when it is red.

Script contract, gotchas, and the assertion list: `scripts/verify-deploy.ts`
(`apps/dashboard/`). The desk job that runs all of this on a schedule is
`local:prod` — see `docs/herdr-desk/prod-watch.md`.

## What each signal is worth

| Probe | Proves | Does NOT prove |
|---|---|---|
| `GET /api/health` (anon) | the Worker is up | which version is deployed |
| `GET /api/health` (authed) | `gitSha` + `buildTimestamp` | that the UI renders |
| `GET /overview?host=0` | the shell serves and the entry bundle is referenced | that data loads |
| `GET /api/v1/host-status?hostId=0` (anon) | **the edge can reach ClickHouse and the Worker can query it** | — (the best anonymous signal there is) |
| `GET /api/v1/agents/config-check` (anon) | the agent has keys and a base URL | that any model id routes |
| `GET /api/v1/agents/models` (anon) | the registry resolves to a list | that a specific id still routes upstream |
| `POST /api/v1/auth/api-key` → `GET /api/v1/menu-counts?hostId=H` | the worker reaches ClickHouse | anything about the agent |
| `POST /api/v1/agent` | a real answer, end to end | — (this is the only full path) |

Anonymous `/api/health` returns `{status, timestamp}` only. Deployment metadata
is deliberately withheld from anonymous callers (#1768), so **you cannot compare
`gitSha` to `origin/main` without a token.** With `CHM_API_KEY_SECRET` in the
env, `verify-deploy.ts` does the authenticated call for you.

## `--skip-auth` passing does not mean ClickHouse is reachable

This is the trap, and it cost a full day of a broken guest experience before
anyone noticed. The authenticated half of `verify-deploy.ts` is the only check
that proves the Worker can *query* ClickHouse, and it needs
`CHM_API_KEY_SECRET`. Without it, run the compensating check:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://dash.chmonitor.dev/api/v1/host-status?hostId=0'
curl -sS https://dash.chmonitor.dev/api/healthz | head -c 400
```

- **500 with `{"error":"error code: 1016"}`** — Cloudflare cannot resolve the
  origin domain. The signature of a ClickHouse host that only resolves on a
  tailnet: a `*.ts.net` MagicDNS name has **no public DNS record**, so it answers
  from a tailnet-connected box and nowhere else. Workers resolve through public
  DNS, so the edge gets 1016 while the host itself is alive and healthy.
- **503 with `hosts[0].status: "down"`** — the Worker is up; upstream is not.
  `/api/healthz` returns 503 for the *whole deployment* when one host is down, so
  read it as a host signal, not a Worker signal.

In cloud mode the env host list *is* the public demo
(`docs/knowledge/cloud-saas-mode.md`) and an anonymous visitor is shown nothing
else — so one unreachable demo host means every guest data read fails while
`/api/health`, `/overview`, the Clerk-key check and the agent gateway all stay
green. Check `cloudMode.mismatch` in the `healthz` payload to rule out a
build/runtime split-brain.

If you are fixing the host: note that `filterToDemoHosts`
(`lib/cloud/demo-hosts.ts`) **fails open** — an allowlist matching zero hosts
shows *all* env hosts rather than emptying the demo — so renaming allowlist
entries neither breaks nor fixes this. Fix the host, then reconcile the names.

## Run it

```sh
cd apps/dashboard

# anonymous only — no secret needed
bun scripts/verify-deploy.ts --skip-auth

# full, including ClickHouse connectivity
CHM_API_KEY_SECRET=… bun scripts/verify-deploy.ts --hosts 0

# a preview deploy
bun scripts/verify-deploy.ts \
  --base-url https://preview.dash.chmonitor.dev --json
```

Flags: `--base-url <url>` (default `https://dash.chmonitor.dev`), `--hosts 0,1`,
`--json`, `--skip-auth`. Exit `0` = all pass, `1` = failures, `2` = harness
error. The secret lives in `apps/dashboard/.env.local` and the GitHub secret of
the same name — source it into the env, never print it.

**When `--skip-auth` is all you can run** (the secret is unset locally), add the
`host-status` probe below. Four green unauthenticated checks and a broken guest
product is a combination that actually happens.

## Agent and guest-model probes

A dead model id is invisible in every health check, and that is exactly how it
broke before: `GUEST_DEFAULT_AGENT_MODEL` is a hard-coded id
(`apps/dashboard/src/lib/billing/guest-ai.ts`) that can go stale while the
client-side override (`agent-runtime-provider.tsx` → `anyrouter:auto`) keeps
the UI working. The default is therefore *masked*, not *fixed*.

```sh
curl -sS https://dash.chmonitor.dev/api/v1/agents/config-check | head -c 400
curl -sS https://dash.chmonitor.dev/api/v1/agents/models     | head -c 400
```

`configured.apiKey: true` with a model list that 404s upstream is a **routing /
account fact, not a code bug**. Record it; do not file a repo issue against the
code for it, and never change a model default or a quota as a drive-by. A
default id is a product decision: it needs a human.

## Usage and quota

- Guest AI: 3 requests/day per IP, 5/min (`GUEST_AI_REQUESTS_PER_DAY`,
  `GUEST_AI_RATE_LIMIT_PER_MIN`). Counts live in D1 `ai_usage_daily`
  (`lib/billing/ai-usage-store.ts`), keyed `guest:<sha256-prefix>` per IP.
- `GET /api/v1/billing/usage` returns the owner's meters vs. plan caps
  (`routes/api/v1/billing/usage.ts`). Auth mirrors the other billing routes;
  anonymous cloud visitors get the slim guest payload.
- Cap pressure that is not explained by real traffic means a retry loop, not
  users. That is an issue with the loop in it, not a quota change.
- Never log a token, key, cookie, or user id. Aggregate counts only.

## Restore service, in this order

1. **Revert PR.** `git revert` the deployed commit on a branch, then
   `gh pr merge --auto --squash`. It takes the same required checks and the same
   deploy path as any other change, and it is reviewable. This is the default
   for every reason.
2. **`wrangler rollback` only** when service is down *now*, a revert PR cannot
   land in time, and both `CLOUDFLARE_API_TOKEN` and `CHM_ALLOW_INSTANT_ROLLBACK=1`
   are in the environment:

   ```sh
   cd apps/dashboard
   pnpm exec wrangler rollback          # to the previous version
   pnpm exec wrangler deployments list  # record the version ids either way
   ```

   Then open the revert PR anyway. An instant rollback with no follow-up leaves
   `main` and production diverged, which is a worse incident than the one you
   just stopped.
3. Record the version ids and the action in the run's `changes.md`.

## Gotchas learned

- `/api/v1/data` rejects arbitrary SQL by design (`permission_error`). Only the
  registry endpoints (`/api/v1/charts/[name]`, `/api/v1/tables/[name]`,
  `menu-counts`, …) run queries — use those to prove connectivity.
- The data API param is `hostId`, not `host`.
- The ClickHouse hosts may be Tailscale Funnel URLs (`*.ts.net`): on the tailnet
  MagicDNS gives a private `100.x` address, but public DNS resolves the funnel
  ingress, so `https://<host>/ping` → 200 and the CF edge can reach it.
- A `chm_` token is JWT-shaped (`chm_<payload>.<sig>`). Extract the **full**
  value including the `.`; a `chm_[A-Za-z0-9_]+` regex truncates it and the
  failure looks like "malformed token".
- Give the Worker a few seconds to propagate after a deploy before probing
  (CI sleeps 5).
- The chart smoke test (`scripts/smoke-test.ts`) is
  `continue-on-error: true` in CI — informational, not a gate.
- `Claude Issues` (red: missing Anthropic credentials) and `promptfoo` (red:
  gateway `404 model_unavailable`) are known-informational on `main`. They are
  not code defects and must not gate anything.
