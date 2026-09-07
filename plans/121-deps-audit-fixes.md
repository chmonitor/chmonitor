# Plan 121: Apply the pnpm audit fixes (dashboard runtime + build-path highs)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/package.json apps/dashboard/pnpm-workspace.yaml apps/dashboard/pnpm-lock.yaml package.json`
> On mismatch, re-read live files.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (mermaid/streamdown peer ranges; SDK bump needs a call-site check)
- **Depends on**: plan 104 (overrides must live where pnpm reads them for pins to apply). If executing standalone, do BOTH migrations in one branch.
- **Category**: deps / security
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3316

## Why this matters

`cd apps/dashboard && pnpm audit --prod` currently reports 8 high advisories
on runtime/build paths (verified during audit):

- Runtime chain via `@clerk/tanstack-react-start > @tanstack/react-start`:
  `js-yaml <4.3.1`, `nanoid <3.3.18`; plus locked `postcss 8.5.16 ≤8.5.17`
  path traversal.
- `mermaid <11.16.1` via `streamdown > @streamdown/mermaid` — renders
  AI-chat output in the browser (CSS injection/DoS surface).
- Direct dep `ip-address ^10.2.0` is itself vulnerable (`<=10.3.0`,
  leading-zero octet misparse) and sits near host-validation code
  (`connection-query/validatePostgresHost`) — SSRF-relevant parsing.
- Build/deploy paths: `brace-expansion >=4 <5.0.9` via `@sentry/vite-plugin`;
  `extract-zip <=2.0.1` + more ip-address via `@cloudflare/puppeteer`.
- Exact override pins now WITHHOLD security patches once migration makes them
  active again: `dompurify=3.4.2` (latest 3.4.14), `ws=8.21.0` (→8.21.3),
  `protobufjs=8.2.0` (→8.7.2), `@anthropic-ai/sdk=0.92.0` (latest 0.120.0).

## Current state

Root `package.json:76–118` override block (migrate per plan 104 first).
Dashboard direct deps: `"ip-address": "^10.2.0"` (package.json:120), wrangler
4.107.0 in lockfile.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Baseline/after audit | `cd apps/dashboard && pnpm audit --prod` | highs drop to 0–2 residual documented |
| Install | `pnpm install` (root + dashboard) | exit 0 |
| Typecheck + unit | `pnpm run type-check && cd apps/dashboard && pnpm run test:unit` | green |
| Chat render smoke | component tests touching markdown/mermaid if present; else manual note | pass |

## Scope

**In scope**:
- Root + dashboard manifests/workspace-yamls: add/update override floors
  (`js-yaml ^4.3.1`, `nanoid ^3.3.18`, `postcss ^8.5.23`, `ip-address ^10.3.1`,
  `mermaid ^11.16.1`, `dompurify ^3.4.14`, `ws ^8.21.3`, `protobufjs ^8.7.2`,
  `brace-expansion ^5.0.9`)
- Bump wrangler to latest 4.x (fixes bundled miniflare/undici dev chain)
- Drop satisfied floors (lodash/qs/minimatch/zod/serialize-javascript/uuid)

**Out of scope**:
- `@anthropic-ai/sdk` 0.92 → 0.120 major-cadence bump (separate PR; needs
  mcp-server call-site API diff — record as follow-up)
- Consolidating pg/postgres drivers (rejected-for-now; ADR follow-up)
- workers-types v5 bump (bundled here ONLY if trivially green; otherwise
  separate — prefer separate)

## Git workflow

- Branch: `advisor/121-audit-overrides`
- Commit: `fix(deps): floor audited transitive vulnerabilities`

## Steps

1. Ensure plan 104's migration shape exists (settings in workspace yamls).
   Add the new floors listed above to root AND dashboard yaml overrides.
2. Delete drop-safe entries; convert exact pins to carets EXCEPT
   @anthropic-ai/sdk (leave at 0.92.0 with a TODO comment line above it).
3. Reinstall both roots; run audits before/after saved into PR body.
4. Battery + component tests for markdown rendering
   (`bun run test:component:headless -- --spec "**/markdown*" || true` best-effort).

## Done criteria

- [ ] `pnpm audit --prod` (dashboard): zero high advisories on runtime paths; remaining items listed+justified in PR body
- [ ] All suites + type-check green; bundle-size CI job green

## STOP conditions

- mermaid ^11.16 conflicts with streamdown's peer range so install fails → try `--legacy-peer-deps`-equivalent pnpm resolution ONCE; if still failing, pin the highest compatible and report.
- Any app fails type-check due to bumped types → revert that single override, report.

## Maintenance notes

- Follow-up candidates recorded by the deps audit: @anthropic-ai/sdk bump,
  workers-types v5, nitro beta float, pg-vs-postgres ADR. Do not start them here.
- Add `pnpm audit --prod` to a monthly scheduled desk task suggestion (note only).
