# 17 — SDK & Public API

> Priority: P2 · Effort: L · Risk: MED · Depends on: 11 (MCP tools), 13 (billing GA — for scope/rate-limit tiers)
> Category: Ecosystem · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

A de-facto HTTP API already exists but is **undocumented and unversioned as a
contract**, so nobody can safely build on it:

- The Rust CLI `rust/ch-monitor-cli` already consumes it: `resolve_config` reads
  `CHM_BASE_URL` / `CHM_HOST_ID` / `CHM_API_KEY`, then `fetch()` calls
  `GET {base}/api/v1/hosts`, `GET {base}/api/v1/charts/{name}?hostId=`,
  `GET {base}/api/v1/tables/{name}?hostId=&pageSize=` with an `x-api-key` header
  and expects `{ data: ... }`. So the shape is real — but only the CLI author
  knows it.
- The route surface (`apps/dashboard/src/routes/api/v1/*`) is large (charts,
  tables, explorer/*, hosts, agent, conversations, insights, findings,
  user-connections, health/*, mcp/*) with **no published schema, no version
  policy, no documented auth/scope model, and no rate-limit contract**.
- Auth is inconsistent across consumers: the CLI sends `x-api-key`, the agent
  route uses `authorizeAgentApiRequest` (Bearer, `AGENT_FEATURE_PERMISSION`),
  MCP requires the `api_mcp_access` capability, and key issuance
  (`api/v1/auth/api-key`) gates on `CHM_API_KEY_SECRET`. There are **no scopes** —
  a key is all-or-nothing.
- Rate limiting exists (`lib/api/rate-limiter.ts`: per-IP + per-identity token
  buckets, `RATE_LIMIT_AGENT_PER_MIN` / `RATE_LIMIT_API_PER_MIN`) but is not
  expressed as a public contract or surfaced via headers.

This blocks the ecosystem/agent-facing thesis: we want people (and _agents_) to
build on chmonitor — MCP is the conversational surface; a documented HTTP API +
thin TS SDK is the programmatic one, with the Rust CLI as the reference consumer.

## Goal

**Ship a documented, versioned, scoped, rate-limit-headered public HTTP API
(`/api/v1`) with a machine-readable OpenAPI spec, verified by a contract test —
and a thin published `@chm/sdk` TypeScript client that is the SDK the docs tell
people to use.** (One measurable outcome: a contract test asserts the published
OpenAPI spec matches the live routes for a defined stable subset, and CI fails if
a route drifts from its contract.)

## Design

### 1. Define the stable public subset (don't freeze everything)

Freeze a **read-first v1 subset** — exactly what the Rust CLI + obvious external
use needs — and mark the rest `internal` (not part of the contract, may change):

- **Stable v1 (contract-tested):** `GET /api/v1/hosts`,
  `GET /api/v1/charts/{name}`, `GET /api/v1/tables/{name}`,
  `GET /api/v1/host-status`, `GET /api/v1/overview`, `GET /api/v1/findings`,
  `POST /api/v1/agent` (streaming), the MCP endpoint (`/api/mcp`), and
  `POST /api/v1/auth/api-key`.
- **Internal (excluded from contract):** `explorer/*` internals, `conversations/*`,
  `billing/*`, `webhooks/*`, `cron/*`, `menu-counts/*`. Documented as unstable.

Envelope stays as-is: `{ data: ... }` on success (the CLI already depends on it);
errors use the existing structured `{ error: { message, code? } }` shape.

### 2. Scopes on API keys (formalize, don't reinvent)

Extend the signed key minted by `@chm/mcp-server/auth.issueApiKey` to carry a
`scopes` claim. Define a minimal scope set:

- `read:metrics` — hosts, charts, tables, overview, host-status.
- `read:insights` — findings, insights.
- `agent:run` — `POST /api/v1/agent` (maps to today's `AGENT_FEATURE_PERMISSION`).
- `mcp:access` — MCP endpoint (maps to today's `api_mcp_access` capability).

Add `requireScope(scope)` in `lib/auth/` that checks the key's scopes and returns
403 when missing. Existing capability/plan gates stay layered on top (a Max plan
still required for `mcp:access` in cloud). **Self-hosted: no key → full access**
(unchanged — self-hosted stays whole; scopes only constrain issued keys).
`api/v1/auth/api-key` accepts an optional `scopes: string[]` in its body (default:
all read scopes) and stamps them into the token.

### 3. Rate-limit contract (surface what already exists)

Emit standard headers from the `api/v1` handlers using the existing
`rate-limiter.ts` result: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`Retry-After` (429 already sets the last). Document the per-IP/per-identity model
and the `RATE_LIMIT_*` env knobs.

### 4. OpenAPI spec as the source of truth + contract test

- Author `apps/dashboard/src/routes/api/v1/openapi.ts` serving
  `GET /api/v1/openapi.json` — an OpenAPI 3.1 document describing the stable
  subset (paths, params, `{data}`/`{error}` schemas, security scheme = API key /
  Bearer + scopes). Generated from Zod where routes already use it; hand-authored
  otherwise. Ship it as `openapi.json` for tooling too.
- Contract test (see Real test) asserts each stable route's actual response shape
  conforms to its OpenAPI schema against fixtures — drift fails CI.

### 5. Thin `@chm/sdk` TypeScript client

- New package `packages/sdk` (`@chm/sdk`, MIT, `publishConfig.access: public`,
  mirroring `@chm/clickhouse-client`'s package.json). Zero heavy deps: a
  `createClient({ baseUrl, apiKey })` returning typed methods for the stable
  subset (`.hosts()`, `.chart(name, {hostId})`, `.table(name, {hostId,pageSize})`,
  `.overview(hostId)`, `.findings(hostId)`, `.agent(messages)` streaming). Types
  imported from `@chm/types` where possible; the `{data}` envelope unwrapped for
  the caller. Sends `Authorization: Bearer` (and accepts the `x-api-key` the CLI
  uses for back-compat).
- The Rust CLI is the **reference consumer**: keep it working unchanged (it hits
  the same stable routes) and cite it in docs as the canonical example.
- `depcruise`: add a boundary rule so `@chm/sdk` may only depend on `@chm/types`
  (no app/server imports leaking into the client).

### 6. Docs

New `docs/content/guide/guides/api.mdx` + `sdk.mdx`: auth (key issuance + scopes),
versioning policy (stable subset vs internal; additive changes only within v1),
rate limits, the OpenAPI link, TS SDK quickstart, and the Rust CLI as the
reference client.

## Steps

1. **(M)** Freeze the stable v1 subset: add an `x-chm-stability: stable|internal`
   marker per route (comment + a registry `lib/api/stability.ts`) and a test
   listing stable routes so the set is explicit.
2. **(L → split)** Scopes on API keys.
   - **(M)** 2a: add `scopes` claim to `issueApiKey`/verify in `@chm/mcp-server/auth`;
     `requireScope()` helper; wire into stable read routes + agent + mcp.
   - **(S)** 2b: accept optional `scopes` in `api/v1/auth/api-key` body; default to
     read scopes; unit-test the mint→verify→gate roundtrip.
3. **(S)** Emit `X-RateLimit-*` headers from `api/v1` handlers via existing
   `rate-limiter.ts`.
4. **(L → split)** OpenAPI + contract test.
   - **(M)** 4a: author `openapi.ts` route + `openapi.json` for the stable subset.
   - **(M)** 4b: contract test validating fixtures against the spec.
5. **(L → split)** `@chm/sdk`.
   - **(M)** 5a: scaffold `packages/sdk` package.json/tsconfig; `createClient` +
     read methods (hosts/chart/table/overview/findings) with `@chm/types`.
   - **(M)** 5b: streaming `.agent()`; depcruise boundary rule; unit tests hitting
     a mock server.
6. **(S)** Docs: `api.mdx` + `sdk.mdx`; reference the Rust CLI; link OpenAPI.

## Real test

Fails today, passes after:

1. **Contract test** `apps/dashboard/src/routes/api/v1/__tests__/openapi-contract.test.ts`:
   for each **stable** route, load a fixture response and assert it validates
   against the schema in `openapi.json`; assert `openapi.json` lists exactly the
   stable subset (a route added/removed without updating the spec fails). Fails
   today (no spec).
2. **Scope test** `lib/auth/__tests__/scopes.test.ts`: a key minted with only
   `read:metrics` is allowed on `GET /api/v1/hosts` and **403 on `POST
   /api/v1/agent`**; a key with `agent:run` is allowed. Fails today (no scopes).
3. **SDK test** `packages/sdk/src/__tests__/client.test.ts`: `createClient` against
   a mock returning `{data}` unwraps correctly and sends the auth header. Fails
   today (no package).

## Verification

```
# contract + scopes
cd apps/dashboard && bun test src/routes/api/v1/__tests__/openapi-contract.test.ts
cd apps/dashboard && bun test src/lib/auth/__tests__/scopes.test.ts

# sdk
bun test packages/sdk/src/__tests__/client.test.ts

# boundaries (SDK may only import @chm/types)
bun run depcruise

# reference consumer still builds against the stable routes
cargo build -p ch-monitor-cli --manifest-path rust/Cargo.toml

# nothing regressed
bun run lint && bun run build && bun run test:unit
```

## Out of scope / STOP conditions

- **Do not freeze the whole route surface.** Only the stable subset is a contract;
  everything else stays `internal` and free to change.
- **Self-hosted stays whole:** scopes constrain _issued keys only_; a self-host
  with no key keeps full access. `mcp:access`/plan gates only bite in cloud.
- No breaking changes to the existing `{data}` envelope or the `x-api-key` header
  the Rust CLI already sends — additive only within v1.
- No new auth provider or OAuth server; reuse the signed-key + Clerk/Bearer paths
  that already exist.
- Don't build client SDKs in other languages now (Rust CLI already covers Rust);
  a Python/Go SDK is post-traction, out of scope.

## Done

- [ ] Stable-subset registry + `x-chm-stability` markers landed.
- [ ] API-key scopes (`read:metrics`/`read:insights`/`agent:run`/`mcp:access`)
      minted + enforced; `requireScope` wired; roundtrip test green.
- [ ] `X-RateLimit-*` headers emitted from `api/v1`.
- [ ] `openapi.json` + `/api/v1/openapi.json` route; contract test green.
- [ ] `@chm/sdk` published-ready package with read + streaming-agent methods;
      depcruise boundary rule added.
- [ ] Rust CLI still builds/runs against the stable routes.
- [ ] Docs: `api.mdx` + `sdk.mdx`; OpenAPI linked; Rust CLI cited as reference.
- [ ] `bun run lint && bun run build && bun run test:unit && bun run depcruise`
      green.
- [ ] Flip the status row for **#17** in `plans/roadmap/README.md` to `DONE`
      (or `IN REVIEW`).
