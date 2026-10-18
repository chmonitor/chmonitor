---
name: cloud-saas-mode
description: >-
  Cloud (dash.chmonitor.dev) vs self-hosted behaviour in chmonitor's one
  codebase. Use when changing the cloud-mode flag, demo hosts, what anonymous
  vs signed-in users see, the welcome/setup page, per-user (D1) connections,
  the "Test connection" error classifier, the sample ClickHouse preset, guest
  AI credits, human /sign-in vs agent /auth.md, or CLI device login.
---

# Cloud (SaaS) vs self-hosted

One codebase, two products. `dash.chmonitor.dev` is Cloud. Docker, Kubernetes,
and a self-built Worker are self-hosted (OSS). Runtime config is the only
difference. The full behaviour matrix, file list, and history live in
[docs/knowledge/cloud-saas-mode.md](../../../docs/knowledge/cloud-saas-mode.md).

## Rules

- **Fail closed to self-hosted.** An unset or junk `CHM_CLOUD_MODE` means not
  cloud. Cloud behaviour only adds (demo hosts, welcome framing, per-user
  storage). Never gate a core monitoring feature behind cloud mode.
- **Cloud mode is a build-time contract (#2515).** The client bundle reads the
  baked `VITE_CLOUD_MODE`, derived in `vite.config.ts` from `CHM_CLOUD_MODE`.
  Set it before the build. `detectCloudModeMismatch` makes `/api/healthz`
  warn when the server and the client build disagree.
- **One resolver per setting.** Booleans go through `parseBool`
  (`lib/config/parse-bool.ts`), the auth provider through `getAuthProvider`
  (`lib/auth/provider.ts`), public read through
  `resolveConfig(...).clerkPublicRead`. Never hand-parse an env var.
- **Config lives in `.env*`.** Hosted non-secret config is
  `apps/dashboard/.env.production` (+ `.env.preview`). `wrangler.toml` has no
  `[vars]`; `apps/dashboard/scripts/patch-wrangler-env.ts` injects them at
  deploy. Self-hosters
  use the same names from `.env.example`. Secrets never go in a committed file.
- **Signed-in cloud users never see demo data.** `FirstRunGate` enforces it in
  the client and `lib/cloud/reject-demo-host.ts` on the server. User
  connections have negative host ids; env and demo hosts are `0, 1, 2…`.
- **Guests are capped.** Anonymous cloud chat is allowed on the demo host only,
  through `authorizeAgentApiRequest`, with a daily cap and a guest rate limit
  billed to the deploy AnyRouter key. Do not loosen it with
  `CHM_FEATURE_AGENT_ACCESS=public`.
- **Signed-out reads that answer 401 are not fetched (#3957).** A client hook
  over a per-owner API reads `useCloudAccess()` (`lib/cloud/use-cloud-access.ts`)
  and fetches only when it is `'open'`; `'pending'` (Clerk loading) shows
  neither data nor prompt. The page shows one `SignInRequired`
  (`components/auth/sign-in-required.tsx`) in place of the panels, not one
  error per panel. Self-hosted is always `'open'`.
- **Human and agent auth URLs stay separate (#3092).** `/sign-in` and
  `/sign-up` are HTML for people. `/auth.md` is for agents. Never let
  `agentDiscoveryHandler` in `start.ts` serve markdown on the human paths.
- **Paid self-host is a commercial license**
  ([commercial-license.md](../../../docs/knowledge/commercial-license.md)), not a
  Polar seat and not a license key in the OSS binary.

## Where to start

Paths are under `apps/dashboard/src/`.

| Change | File |
|---|---|
| The flag | `lib/cloud/cloud-mode.ts` |
| Host list, demo tagging, hide when signed in | `lib/swr/use-merged-hosts.ts` |
| Welcome/setup page (3 variants) | `components/host/first-run-empty-state.tsx` |
| "Test connection" errors | `lib/connection-errors.ts` (extend `RULES`, specific first) |
| Sample ClickHouse preset | `components/connections/sample-preset.ts` |
| Guest AI quota | `lib/billing/guest-ai.ts`, `routes/api/v1/-agent/billing.ts` |
| Agent control and integration tools | `lib/ai/agent/control-tools-gate.ts`, `integration-tools-gate.ts` |

## Verify

```sh
cd apps/dashboard && bun test src/lib/cloud src/lib/connection-errors.test.ts
```

When you change any behaviour above, update this skill and the knowledge doc
in the same change.
