# Plan 111: Lazy-load react-markdown out of the dashboard shell chunk

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/components/whats-new/ apps/dashboard/src/components/layout/dashboard-shell.tsx apps/dashboard/src/components/dashboard/widget-text.tsx apps/dashboard/src/components/feedback/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3306

## Why this matters

`dashboard-shell.tsx` → `whats-new-provider.tsx` → `whats-new-dialog.tsx` →
`whats-new-markdown.tsx` statically imports `react-markdown` + `remark-gfm`
into the common shell bundle that EVERY dashboard route loads — for a dialog
most sessions never open. The stack is ~160 KB per the repo's own comment in
`advanced-formatters.tsx:83`. Plan 89 fixed this identical pattern twice
(`table-client.tsx:69`, `advanced-formatters.tsx:88–96`) and has landed; two
regressions of the same class remain (What's New dialog, plus
`widget-text.tsx:9` and `feedback/optional-table-info.tsx:5`). The dashboard
has a 2.5 MiB warn budget enforced by CI (`bundle-size.yml`).

## Current state

- `apps/dashboard/src/components/layout/dashboard-shell.tsx:15`:
  `import { WhatsNewProvider } from '@/components/whats-new/whats-new-provider'`
- `whats-new-provider.tsx:10` imports the dialog; `whats-new-dialog.tsx:5`
  imports `WhatsNewMarkdown`; `whats-new-markdown.tsx:1–3`:
  ```ts
  import type { Components } from 'react-markdown'
  import ReactMarkdown from 'react-markdown'
  ```
- Exemplar lazy pattern (`tables/table-client.tsx:69–79`):
  `React.lazy(() => import(...))` + `<Suspense fallback={<plain text/>}>`.
- Other sites: `components/dashboard/widget-text.tsx:9`, and
  `components/feedback/optional-table-info.tsx:5` (barrel-exported via
  `components/feedback/index.ts:14` — check whether the barrel itself is what
  pulls it into shells; fix at usage site with a lazy wrapper regardless).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm run type-check` | exit 0 |
| Build + size gate | `cd apps/dashboard && pnpm run build` | exit 0; bundle-size workflow threshold not exceeded |
| Unit tests | `pnpm run test:unit` | pass |

## Scope

**In scope**:
- `apps/dashboard/src/components/whats-new/whats-new-markdown.tsx` (or its consumer — whichever yields true code-splitting)
- `apps/dashboard/src/components/dashboard/widget-text.tsx`
- `apps/dashboard/src/components/feedback/optional-table-info.tsx`

**Out of scope**:
- table-client / advanced-formatters (already done)
- Removing react-markdown or switching markdown libraries
- The dialog/provider logic

## Git workflow

- Branch: `advisor/111-lazy-markdown-shell`
- Commit: `perf(dashboard): lazy-load react-markdown outside the shell chunk`

## Steps

1. In each of the three files, replace the static ReactMarkdown import with the
   established lazy pattern from `table-client.tsx:69–79` (React.lazy +
   Suspense + plain-text fallback showing the raw string). For
   whats-new-markdown: if it renders inside a dialog opened on demand, the
   cleanest split point is making the DIALOG lazily imported by the provider —
   pick whichever single change removes react-markdown from the shell's static
   graph; verify with Step 3.
2. Verify no other shell-path module statically imports these three files.
3. Prove the split: after building, inspect `dist/` chunks for react-markdown
   NOT appearing in the entry/shell chunk:
   `grep -rl "micromark" apps/dashboard/dist/assets/ 2>/dev/null | head -3` —
   none of the matched files may be the entry HTML's primary chunk. If build
   layout differs, use `ANALYZE`-free heuristic: main chunk size drop vs prior
   build recorded in NOTES.

## Test plan

No behavior change intended; existing tests must pass. If a component test
renders WhatsNewMarkdown via the provider synchronously, update it to await the
lazy boundary per existing post-plan-89 component-test patterns.

## Done criteria

- [ ] `rg -n "from 'react-markdown'" apps/dashboard/src/components --include-zero` shows only lazy `import()` call sites on the three paths
- [ ] Build passes; shell/main chunk no longer contains micromark (verified per Step 3)
- [ ] test:unit + type-check green

## STOP conditions

- Lazy-splitting whats-new turns out impossible without changing public props/APIs used elsewhere → group-scope down to the two simpler files, report.
- Bundle-size workflow fails on the PR for unrelated pre-existing reasons → note and proceed if locally verified smaller.

## Maintenance notes

- Convention: react-markdown must never enter any module imported by
  dashboard-shell or route-level layouts. Consider an eslint/biome ban later;
  out of scope here.
- Reviewers: check the What's New dialog still renders markdown correctly when
  opened (manual smoke).
