# Desk playbook: production watch

Prove the deployed product is up, and its paid features actually work. Runs
every 30 minutes. Read-mostly: this job observes, and it may restore service —
it may not ship features.

Deployment itself is automatic (`.github/workflows/cloudflare.yml` deploys the
dashboard on every push to `main` and runs `verify-deploy.ts` in the same
workflow). So this job is the *second* pair of eyes: it catches a deploy that
went green in CI and is still broken in production, which is the failure mode
CI cannot see.

## 1. Liveness and identity

```sh
curl -sS https://dash.chmonitor.dev/api/health | head -c 400
curl -sS -o /dev/null -w '%{http_code}\n' https://dash.chmonitor.dev/overview?host=0
```

Anonymous `/api/health` returns `{status, timestamp}` only — deployment metadata
is withheld from anonymous callers (#1768), so `gitSha` and `buildTimestamp` need
a token. **`CHM_API_KEY_SECRET` is empty in `apps/dashboard/.env.local`, so
treat the authenticated half as unavailable** and use these two instead:

```sh
# deploy freshness, answering the same question without a token
gh run list --branch main --limit 5 \
  --json workflowName,conclusion,headSha -q \
  '.[] | select(.workflowName=="Deploy to Cloudflare Workers")'

# the compensating data check — see §2a
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://dash.chmonitor.dev/api/v1/host-status?hostId=0'
```

A green deploy run whose `headSha` matches `origin/main` means the deploy that
should have run, ran. That is strong but indirect: **a run-list check is not a
health check.** If `gitSha` is older than the newest commit on `origin/main`, the
dashboard deploy has not landed — check the `Deploy to Cloudflare Workers` run
for `main`.

## 2. Full verification

Follow the **`verify-production`** skill
(`.claude/skills/verify-production/SKILL.md`) — the durable knowledge for what
each probe does and does not prove. Short version:

```sh
cd apps/dashboard
bun scripts/verify-deploy.ts --skip-auth          # no secret needed
# with the authenticated half, when CHM_API_KEY_SECRET is in the env:
bun scripts/verify-deploy.ts --hosts 0
```

This is the same script CI runs, so a failure here with a green CI is the
signal worth escalating. Never print the secret; source it from
`apps/dashboard/.env.local` if it is there.

### 2a. The compensating check — do not skip it

`--skip-auth` passing **does not mean ClickHouse is reachable.** The
authenticated half (`--hosts 0`) is the only check that proves the Worker can
*query* ClickHouse, and it needs `CHM_API_KEY_SECRET`. When that secret is
absent, one probe stands in for it, and it is the single most valuable anonymous
signal in this whole playbook:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://dash.chmonitor.dev/api/v1/host-status?hostId=0'
curl -sS https://dash.chmonitor.dev/api/healthz | head -c 400
```

- **200 / `ok:true`** — the edge can reach the host and the Worker can query it,
  but only from a *fresh* response: a cached 200 replayed a dead host as `up`
  for 7 minutes while `/api/healthz` said `down` (#3529). `host-status` now
  sends `no-store`, so read a `cf-cache-status: HIT` with a growing `age` as
  "unknown", not "up".
- **500 with `error code: 1016`** — Cloudflare cannot resolve the origin domain.
  This is the exact signature of a ClickHouse host that only resolves on a
  tailnet (a `*.ts.net` MagicDNS name has no public DNS record), which takes
  down every guest data read while `/api/health` stays green.
- **503 with `hosts[0].status: "down"`** — the Worker is up; upstream is not.

`/api/healthz` returns 503 for the whole deployment when a single host is down,
so treat it as a host signal, not a Worker signal. In cloud mode the env host
list *is* the public demo, so one unreachable demo host means the entire
anonymous experience is broken while every liveness probe passes. That is the
blind spot this job exists to cover.

## 3. The paid features actually work

Health endpoints prove the Worker is up. They do not prove a guest can get an
answer, and a dead model id is invisible in `/api/health`. Probe the paths that
have broken before:

```sh
# is the agent configured at all (anonymous read is allowed in cloud mode)
curl -sS https://dash.chmonitor.dev/api/v1/agents/config-check | head -c 400

# does the model list resolve
curl -sS https://dash.chmonitor.dev/api/v1/agents/models | head -c 400
```

If you have a token: `GET /api/v1/billing/usage` (see
`apps/dashboard/src/routes/api/v1/billing/usage.ts`). A `404
model_unavailable` or a `402` from the gateway is an **account/routing fact,
not a code bug** — record it, do not open a PR against the repo for it.

## 4. Usage watch

- Guest AI cap is 3 requests/day per IP, 5/min
  (`apps/dashboard/src/lib/billing/guest-ai.ts`). Counts live in D1
  `ai_usage_daily`. If the cap is being hit by traffic rather than by a stuck
  retry loop, that is a cost problem worth an issue.
- `GUEST_DEFAULT_AGENT_MODEL` is `anyrouter:auto`, a dynamic alias, so it does
  not go stale. The web client no longer overrides the model for guests; the
  server (`hardenGuestAgentRequest`) forces the default. If a probe shows the
  default 404s or 402s, that is a gateway/account fact, not a code bug.
- Never log a token, key, cookie, or user id. Aggregate counts only.

## 5. When something is broken

Classify before acting:

| Symptom | Owner | Action |
|---|---|---|
| Worker 5xx, `/api/health` down | deploy | restore service (below) |
| `/api/health` fine, a feature broken | code | open an issue with the probe output |
| Gateway 402/404/429 | account | record it; do not file a code issue |
| `gitSha` behind `origin/main` | CI | check the deploy run; file if it failed |

**Restoring service**, in this order:

1. Open a **revert PR** for the commit that deployed (`git revert` on a branch,
   `gh pr merge --auto --squash`). It goes through the same required checks and
   the same deploy path as any other change, and it is reviewable. This is the
   default.
2. Only if service is down *now* and a revert PR cannot land in time, and only
   if `CLOUDFLARE_API_TOKEN` and `CHM_ALLOW_INSTANT_ROLLBACK=1` are both in the
   environment:

   ```sh
   cd apps/dashboard
   pnpm exec wrangler rollback          # to the previous version
   ```

   Then open the revert PR anyway, so `main` and production converge. An
   instant rollback with no follow-up is a hidden divergence, which is worse
   than ten minutes of downtime.
3. Whatever you did, record it in `changes.md` with the version ids involved.

## 6. Non-blocking red on `main`

`Claude Issues` (missing Anthropic credentials), `promptfoo` (gateway
`404 model_unavailable`), and `codecov/patch` are known-informational. Do not
chase them and do not let them gate anything — but do re-file once if the
underlying account fact has plausibly changed.

## Report

`changes.md` with: `gitSha` observed, verify-deploy pass/fail per check, agent
probe result, usage deltas, and any action taken (revert PR / rollback /
issue filed). One toast:

```sh
herdr notification show "chmonitor prod" --body "{{runDir}}/changes.md"
```

A quiet night is a green report, not an empty one. Write the numbers.
