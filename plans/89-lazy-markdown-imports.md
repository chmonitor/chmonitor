# Plan 89: Lazy-load the markdown stack out of the common table-page bundle

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/components/tables/table-client.tsx apps/dashboard/src/components/data-table/cells/markdown-format.tsx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2506

## Why this matters

`react-markdown` + `remark-gfm` (the full remark/micromark stack, tens of KB
gz) are statically imported into `table-client.tsx` — the shared component
behind every one of the 60+ monitoring table routes — solely for
`GuidanceMarkdown`, which renders only on the rare table-missing error branch.
A second static import sits in the data-table formatter registry. The repo
already blesses lazy-loading heavyweights this way (`lib/sql-format.ts` lazily
`import('sql-formatter')`).

## Current state

`apps/dashboard/src/components/tables/table-client.tsx:7-8`:

```ts
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
```

Used only by the `GuidanceMarkdown` helper in the same file (error branch).

`apps/dashboard/src/components/data-table/cells/markdown-format.tsx:1` —
`import Markdown from 'react-markdown'`, re-exported through
`components/data-table/formatters/advanced-formatters.tsx` (~lines 22-24) into
the formatter registry loaded with the table system.

Other static `react-markdown` users (leave alone unless trivially co-fixed):
`charts/chart-error.tsx`, `feedback/optional-table-info.tsx`,
`dashboard/widget-text.tsx`.

Exemplar pattern: `apps/dashboard/src/lib/sql-format.ts` (dynamic
`import('sql-formatter')`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build + analyze | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests | `cd apps/dashboard && bun test src/components` | all pass |

## Scope

**In scope**: `table-client.tsx`, `cells/markdown-format.tsx` (convert to
`React.lazy` + `Suspense` with a plain-text fallback), optionally the three
other users if the shared lazy wrapper makes it a one-liner (create
`components/markdown/lazy-markdown.tsx`).

**Out of scope**: `streamdown` (AI chat streaming — different, intentional);
swapping renderer libraries (react-markdown vs streamdown consolidation is a
separate investigation — note it in the PR description as follow-up).

## Git workflow

- Branch: `advisor/89-lazy-markdown-imports`
- Commit: `perf(tables): lazy-load react-markdown out of the table page chunk`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Shared lazy wrapper
`components/markdown/lazy-markdown.tsx`: `React.lazy(() => import('react-markdown'))`
plus a lazy remark-gfm (bundle both in one dynamic chunk — a tiny inner module
importing both and exporting a configured component avoids two waterfalls).
Fallback: render the raw string in a `<span className="whitespace-pre-wrap">`.
**Verify**: build green.

### Step 2: Convert the two hot sites
`table-client.tsx` `GuidanceMarkdown` and `cells/markdown-format.tsx` use the
wrapper.
**Verify**: `rg -n "^import ReactMarkdown|^import Markdown from 'react-markdown'" apps/dashboard/src/components/tables apps/dashboard/src/components/data-table` → no static imports remain.

### Step 3: Confirm the chunk moved
Compare build output: after `pnpm run build`, check the client assets for a
separate chunk containing react-markdown (`rg -l "micromark" apps/dashboard/.output/public/assets | head` — it should NOT be the same chunk that contains the DataTable/table-client code; identify the table chunk by a distinctive string like `"Capped"`).
**Verify**: markdown chunk ≠ table chunk.

## Done criteria

- [ ] No static react-markdown import on the table-page path
- [ ] Error branch still renders markdown (manually or via existing tests)
- [ ] Build green, chunk separation confirmed; `plans/README.md` updated

## STOP conditions

- `React.lazy` inside a table cell renderer causes suspense-boundary issues
  (cells render outside a Suspense boundary) — wrap locally; if the table
  architecture fights it, report.

## Maintenance notes

- Deferred follow-up (deliberate): evaluate consolidating static markdown sites
  onto streamdown's static mode to drop `react-markdown` entirely (audit
  finding DEBT-06) — only after this lands and only with visual parity checks.
