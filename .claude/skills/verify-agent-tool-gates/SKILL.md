---
name: verify-agent-tool-gates
description: >-
  Exhaustively check the chmonitor agent's tool-gate invariants: a destructive
  control tool is never callable by an anonymous cloud visitor or without
  permission; Postgres/PeerDB tools appear only with their gates; and
  search_tools only advertises tools that are really callable. Use when a
  change touches control-tools-gate.ts, tools/index.ts (createAllTools),
  catalog-tools.ts, host-query.ts bindToolsToConnection, clickhouse-agent.ts
  filterTools, integration gates, or the agent route's control-tool wiring.
---

# Verify agent tool gates

## What is verified

These are the promises, in plain words.

- **W (write safety).** The agent can run `kill_query`, `optimize_table`, or
  `kill_mutation` only when all of the following hold:
  - the resolver allowed it;
  - the `actions` permission passed;
  - `AGENT_ENABLE_CONTROL_TOOLS` is not off;
  - the request did not disable the tool;
  - no user connection is bound. If one is, the tool's execute refuses.

  An anonymous cloud visitor never gets one. *Harm if broken:* a public demo
  visitor kills queries or runs OPTIMIZE on a cluster.
- **L (liveness).** A non-anonymous OSS caller with the flag unset and actions
  allowed does get all three. *Why:* without it, W passes on a map that never
  contains control tools.
- **I (integration safety).** Postgres and PeerDB tools appear only when their
  integration gate is on and the `CHM_FEATURE_POSTGRES_SOURCE` /
  `CHM_FEATURE_PEERDB_AGENT` kill switches are not off. *Harm:* the model
  queries a source the operator turned off.
- **S (search honesty).** Two things must match exactly:
  - the set `search_tools` reports as callable (catalog minus
    `unavailable_due_to_gates`) equals the catalog tools in the map the
    `ToolLoopAgent` receives;
  - `callable_tool_count` equals that map's size.

  *Harm:* the model calls a tool that does not exist and wastes a step, or
  concludes a capability is missing.

## Tool and why

The check is exhaustive enumeration over the real code, in a bun test.

- The gate is a pure function of a finite request shape. There is no
  concurrency and no ordering question, so a model checker such as TLA+ would
  only re-model code that we can run directly.
- Every combination is checked:
  - 11 flag strings covering every `parseBool` class (unset, empty, the true
    and false forms with case and whitespace, junk);
  - cloud or OSS;
  - all 4 `AUTH_PROVIDERS`;
  - signed in or not;
  - actions permission allowed or denied;
  - connection bound or not;
  - integrations both on or both off;
  - kill switches unset or `false`;
  - several `disabledTools` sets.
- This covers 5,632 shapes for W/L/I and 2,048 for S.
- No new dependency: it runs on bun 1.3.x, the repo's pinned test runner.

## Run

```sh
cd apps/dashboard && bun test ./src/lib/ai/agent/__tests__/tool-gate.formal-check.ts 2>&1 | grep -v '^{"level'
```

- It takes about 35 s. Expected result: `3 pass, 0 fail`.
- The JSON log lines are the connection-refusal probes, so drop them.
- The file name deliberately does not match `*.test.ts`, so the required
  `unit-tests` job does not pay 35 s on every PR. Run it by its explicit
  `./` path.
- The existing fast 18-cell matrix in
  `tools/__tests__/create-all-tools-gate.test.ts` stays in CI.

## Findings (current code)

**S fails whenever `disabledTools` removes a callable tool.**

- Counterexample: a request with `disabledTools: ['query']`.
  1. The route calls `createClickHouseAgent`.
  2. `createAllTools()` builds the map and binds `search_tools` to it, with
     `query` still present.
  3. `filterTools()` (`clickhouse-agent.ts`) deletes `query`.
  4. `search_tools` still advertises `query` as callable and reports
     `callable_tool_count` one too high.
- The same happens for `['kill_query']` (an OSS caller with control on) and
  for `['get_peerdb_metrics']` (PeerDB on).
- This is encoded as `test.failing`. It stays green while the finding exists
  and turns red when someone fixes it, for example by applying `disabledTools`
  before `createSearchTools` binds. At that point, change it to a plain
  `test`.
- Product code was not changed.

## Covered code (sync commit `2ed07db0c`)

| Property | File / function |
|---|---|
| W, L | `apps/dashboard/src/lib/ai/agent/control-tools-gate.ts` `resolveControlToolsEnabled` |
| W | `apps/dashboard/src/routes/api/v1/agent.ts` `handlePost`: `includeControlTools = controlToolsEnabled && !actionsPermissionResponse` (mirrored by hand in `finalTools()`) |
| W, I, S | `apps/dashboard/src/lib/ai/agent/tools/index.ts` `createAllTools` (env kill switches, integration spreads, `createSearchTools(tools)` last, `bindToolsToConnection`) |
| W | `apps/dashboard/src/lib/ai/agent/host-query.ts` `bindToolsToConnection`, `CONNECTION_UNSUPPORTED_TOOLS` |
| S | `apps/dashboard/src/lib/ai/agent/tools/catalog-tools.ts` `createSearchTools` (`registered`, `unavailable_due_to_gates`, `callable_tool_count`) |
| S, W | `apps/dashboard/src/lib/ai/agent/clickhouse-agent.ts` `createClickHouseAgent`, `filterTools`, `agent.tools` |
| domain | `lib/config/parse-bool.ts`, `lib/auth/auth-providers.ts` `AUTH_PROVIDERS`, `tools/catalog.ts` categories `postgres` / `peerdb` |

**Does my change touch this?** Run:

```sh
git diff --name-only 2ed07db0c -- apps/dashboard/src/lib/ai/agent/control-tools-gate.ts apps/dashboard/src/routes/api/v1/agent.ts apps/dashboard/src/lib/ai/agent/tools/index.ts apps/dashboard/src/lib/ai/agent/host-query.ts apps/dashboard/src/lib/ai/agent/tools/catalog-tools.ts apps/dashboard/src/lib/ai/agent/clickhouse-agent.ts apps/dashboard/src/lib/config/parse-bool.ts
```

If it lists anything, rerun the check and re-read the matching row.

Move the sync commit forward only after you have confirmed that the check
still describes the code at the new commit. In particular, the route mirror
in `finalTools()` must still match `agent.ts`.

## Scope and assumptions

- **Verified:** the composition from the resolver to `agent.tools`, over the
  domain above, with a mocked ClickHouse client and a mock language model.
  Model text cannot change which tools are in the map.
- **Mirrored, not executed:**
  - the route's `actionsPermissionResponse` (modelled as a boolean);
  - the per-conversation integration pin (modelled as the `integrations`
    booleans).
- **Not covered:**
  - MCP `extraTools`, which are not in the catalog;
  - what a control tool does once it is called;
  - `CHM_DISABLED_FEATURES` inside `authorizeFeatureRequest`;
  - the client UI's tool toggles, which only produce `disabledTools`.

## Real bug or modelling error?

A counterexample line is a request shape in JSON, for example
`W anon-cloud got kill_query: {"flag":"true","cloud":true,…}`. Replay it by
hand:

1. Call `resolveControlToolsEnabled` with those fields.
2. AND the result with `actionsAllowed`.
3. Call `createAllTools` / `createClickHouseAgent` and inspect the keys.

Then decide:

- If the real route would build the same map, it is a **real bug**. Report it
  with the shape. Do not weaken the property.
- If the route no longer composes the way `finalTools()` does (a new argument,
  a new gate), it is a **modelling error**. Update `finalTools()` to match the
  route, cite the line, and rerun.
- If a change is intended (for example, cloud signed-in users get control
  tools by default), update the property and its plain-language line here in
  the same change.

## Proven able to fail

Proven on 2026-10-23. Scratch breaks were made in the real code and reverted
with `cp` from a backup:

- Deleting `if (cloud && !signedIn) return false` in `control-tools-gate.ts`
  made W fail with `W anon-cloud got kill_query: {"flag":"true","cloud":true,"authProvider":"none","signedIn":false,…}`.
- Binding `createSearchTools({ ...tools, ...createPeerDBTools() })` in
  `tools/index.ts` made S fail with
  `S advertises missing get_peerdb_mirror_status` and
  `callable_tool_count 37 != map size 35`.

After both reverts, the result was back to `3 pass, 0 fail`. Repeat a break
like these after any edit to the check file itself.

To bring this check back in line after changes that skipped it, run
`/pstack:maintain-formal-verification-skill`.
