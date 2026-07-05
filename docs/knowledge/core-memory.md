---
id: core-memory
title: Automation Core Memory
type: workflow
status: active
updated: 2026-06-01
tags:
  - automation
  - code-smell
  - dead-code
  - docs
related:
  - conventions
  - deployment
---

# Automation Core Memory

Durable code-smell/dead-code automation memory. Do not create dated files under `docs/reviews/code-smell-dead-code-*.md`.

## Commands

- Since last run: `git log --since='<ISO_TIME>' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Since last run (source commits only): `git log --since='<ISO_TIME>' --no-merges --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Fallback window (24h): `git log --since='24 hours ago' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Fallback window (7d): `git log --since='7 days ago' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Empty-window rule: if since-last-run has zero commits, run 24h then 7d fallback and report no-op when both are empty
- Dead-code evidence: `rg -n "\b<SYMBOL>\b" --glob '!**/__tests__/**' --glob '!**/*.test.*' --glob '!**/*.spec.*'`
- Main CI status: `gh run list --branch main --limit 10 --json workflowName,status,conclusion,headSha,url`
- Failed-job logs (restricted cache env): `XDG_CACHE_HOME=/private/tmp/gh-cache gh run view <RUN_ID> --job <JOB_ID> --log-failed`
- Cloudflare worker size dry-run: `pnpm exec wrangler deploy --minify --dry-run`

## Repo Notes

- `AGENTS.md` is a symlink to `CLAUDE.md`; edit `CLAUDE.md` to keep both in sync
- `/docs` route reads source files from `docs/content` through `app/(docs)/docs/_lib/docs.ts`
- Verify dead-code claims with zero non-test references before deleting symbols
- Data-table synthetic utility column ids are `__expand`, `select`, and `action` (singular); exclude them from client-side filter/search/sort targets and card-control affordances
- Collapsible TSR chart strips must unmount hidden chart subtrees, not just set `grid-rows-[0fr]` / `opacity-0`; otherwise auto-refreshing charts keep polling while invisible. The 30-minute TanStack Query `gcTime` already preserves fast reopen from cache.
- Docker build must install full deps (`pnpm install --frozen-lockfile --ignore-scripts`) because `lib/platform/adapters/cloudflare.ts` imports `@opennextjs/cloudflare` during `pnpm run build`
- If automation checkout is detached (`git status --short --branch` shows `HEAD (no branch)`), stale versus `origin/main`, or `.git/worktrees/...` writes fail (`FETCH_HEAD`/`HEAD.lock`/`index.lock`), run `git -C /Users/duet/project/clickhouse-monitor fetch origin`; if that checkout is dirty, create a clean worktree under `/private/tmp` for commit/PR commands

## Latest Update

- 2026-05-13: validate `hostId` for dashboard settings API and remove unused docs export type
- 2026-05-13: removed unused `getDocsSlugs` and memoized `getDocsPage` with React `cache`
- 2026-05-14: removed four zero-reference dead-code candidates from recent auth/deploy changes (`HeaderClient`, `getClerkPublishableKey`, `SemverRange`, `QueryConfigNoName`)
- 2026-05-15: fixed Docker CI break by skipping Husky in production install (`HUSKY=0 bun install --production`) and removed global SQL validator mock from `helpers.test.ts` to avoid cross-suite pollution
- 2026-05-15: follow-up Docker fix uses `bun install --production --ignore-scripts` because Bun still executes root `prepare`; agent route tests now set `LLM_API_KEY`/`LLM_MODEL` in `beforeEach` to avoid provider-preflight `503` from ambient CI env
- 2026-05-16: fixed `Image build and Push` failures on main (`Module not found: Can't resolve '@opennextjs/cloudflare'`) by removing Docker `--production` install in the deps stage while keeping `--ignore-scripts`
- 2026-05-17: automation run started on detached worktree (`HEAD (no branch)`), so branch/PR work should pivot to `/Users/duet/project/clickhouse-monitor` when git metadata writes fail in `.git/worktrees/...`
- 2026-05-18: no commits since last run timestamp; 24h fallback was empty, 7d fallback used for evidence-only audit with no new actionable code-smell/dead-code/perf findings
- 2026-05-19: removed zero-reference `findModelEntry` export from `lib/ai/agent-model-registry.ts`; add `--no-merges` scan variant to reduce merge-only noise in code-smell/dead-code windows
- 2026-05-21: removed overview chart helper exports that had zero non-test references (`getTabConfig`, `getAllChartIds`, `getChartsForTab`); latest `main` CI was green on `7be1682b`
- 2026-05-23: from `268f01e48a03003770e1fae11b179a91a224b1b4` window (since `2026-05-22T04:06:53.367Z`), identified a running-queries row-identity regression risk in `components/running-queries/running-queries-table.tsx` where missing/empty `query_id` values collapsed table keys/actions; fixed by adding a stable `key` fallback for UI state and guarding query-detail links/actions when `query_id` is absent. No additional confirmed dead-code candidates in changed files. Main CI check for current merge (`268f01e4`) currently shows Deploy and Image build green, Test cancelled.
- 2026-05-23 (follow-up): E2E failures in PR `#1159` were traced to an intermittently visible issues overlay button (`button[data-issues-collapse="true"]`) covering the user trigger during Cypress auth menu actions and causing `cy.click` timeouts. Hardened `cypress/e2e/authentication.cy.ts` with an overlay-dismiss helper and consistent `openUserMenu` menu-entry flow to keep coverage stable without changing app behavior.
- 2026-05-23 (follow-up): Full `cypress/e2e/authentication.cy.ts` logs in PR check `26313228001` showed 8 hard failures caused by `nav-user-trigger` being covered; follow-up hardening removes `should('be.visible')` assertions before clicking/focusing and relies on `click({ force: true })` after overlay dismissal to prevent false negatives from transient blockers.
- 2026-05-22 (follow-up): CI run `26316686483` (`Test` job on `main`) reported repeated `CypressError: Timed out after waiting 30000ms for your remote page to load` in `host-switching.cy.ts` and `navigation.cy.js`; removed hardcoded `timeout: 30000` from those `cy.visit` calls so they follow global `pageLoadTimeout`.
- 2026-05-29: from the `2026-05-28T06:13:19.122Z` window, fixed `lib/peerdb/peerdb-config.ts` so invalid `PEERDB_CACHE_TTL_MS` / `PEERDB_CACHE_MAX_ENTRIES` env values fall back to safe defaults instead of disabling TTL/cap logic, and hardened `.github/workflows/release.yml` so rerunning the release workflow for the same tag does not prepend duplicate generated notes to an existing GitHub release.
- 2026-06-01: from the `2026-05-30T06:48:11.063Z` window, fixed a data-table header regression in `apps/web/components/data-table/components/data-table-header.tsx` where the advanced-filter picker excluded `actions` but the synthetic menu column id is `action`; this caused a non-data action column to appear as a filter target after the 2026-05-31 data-table header rewrite. Added a component test in `data-table-header.cy.tsx` to keep `action` out of advanced-filter options. Broader repo verification remained blocked in the detached automation worktree by existing environment issues (`bun run test:unit` module-resolution errors, `bun run build` Turbo bun.lock parse failure, Cypress via Bun tempdir `PermissionDenied`).
