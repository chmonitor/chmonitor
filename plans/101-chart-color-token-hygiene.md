# Plan 101: Chart color token hygiene — Tailwind purge hazard, palette-class colors, ui/ folder boundary

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/components/charts apps/dashboard/src/components/ui`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW–MED (visual changes; verify both themes)
- **Depends on**: none
- **Category**: tech-debt (design system)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2518

## Why this matters

Three design-system erosions:

1. **Latent prod-only purge hazard**: two files build `bg-chart-${n}` class
   names at runtime. Tailwind's build strips classes it can't see statically;
   these currently survive ONLY because `log-level-distribution.tsx` happens to
   list `'bg-chart-1'..'bg-chart-5'` literals in the same bundle — its comment
   documents exactly this hazard. Removing that file's list would silently
   uncolor other charts in production only.
2. **Hardcoded Tailwind palette colors** (`bg-emerald-500`, `bg-red-700`, …)
   in several chart status displays bypass the theme's `--chart-*` / semantic
   tokens and carry no `dark:` variants.
3. **App-specific components living in `components/ui/`** (the folder the
   convention reserves for pristine shadcn CLI output): `debounced-input.tsx`
   (imports an app hook), `message-scroller.tsx`, `attachment.tsx`.

## Current state

- Runtime class construction: `components/charts/primitives/proportion-list.tsx:52`
  and `components/charts/query/query-type.tsx:30` — `bg-chart-${(index % 5) + 1}`.
  The documenting workaround: `components/charts/logs/log-level-distribution.tsx:22-29`.
- Palette classes: `charts/query/query-type.tsx:10-14`
  (emerald/blue/red/orange-500), `charts/logs/log-level-distribution.tsx:10-18`
  (red-700…gray-400), `charts/query/query-cache-usage.tsx:15` (blue-500),
  `charts/system/disk-usage.tsx:46-47` (amber/red-500). Also
  `lib/color-bank/index.ts:112-116` emits theme-agnostic fixed `hsl(...)`
  strings (leave color-bank alone — it feeds BackgroundBar tints and is
  deliberate; just note it).
- ui/ boundary: `components/ui/debounced-input.tsx:27` imports
  `useDebounceWithPending` from `@/lib/hooks`; `message-scroller.tsx`,
  `attachment.tsx` are bespoke assistant-ui companions.
- Conventions doc: `docs/knowledge/product-design.md` (tokens `--chart-1..13`,
  semantic status colors; "never edit components/ui/").

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests | `cd apps/dashboard && bun test src/components` | all pass |
| Purge check | `rg -o "bg-chart-[0-9]+" apps/dashboard/.output/public/assets -h \| sort -u` (post-build) | bg-chart-1..N present |

## Scope

**In scope**: the four chart files with palette classes; the two runtime-class
sites (+ a shared `CHART_BG_CLASSES` literal array); moving the three ui/
files to `components/` with import updates; `docs/knowledge/product-design.md`
update (standing instruction: skills/knowledge docs update with convention
changes).

**Out of scope**: `lib/color-bank` internals; theme token definitions; any
`components/ui/` file that IS a shadcn primitive.

## Git workflow

- Branch: `advisor/101-chart-color-token-hygiene`
- Commits: one per numbered concern
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Kill the purge hazard
Create `components/charts/chart-bg-classes.ts`:
`export const CHART_BG_CLASSES = ['bg-chart-1','bg-chart-2','bg-chart-3','bg-chart-4','bg-chart-5'] as const`
(static literals = purge-safe). Replace the runtime template strings in
`proportion-list.tsx` and `query-type.tsx` with `CHART_BG_CLASSES[index % CHART_BG_CLASSES.length]`;
point `log-level-distribution.tsx`'s local list at the shared one.
**Verify**: post-build purge check above still shows the classes; `rg -n "bg-chart-\$\{" apps/dashboard/src` → no matches.

### Step 2: Tokenize status colors
For each palette-class site, map to theme tokens: chart-series colors →
`CHART_BG_CLASSES`/`--chart-N`; semantic status (error/warn/ok) → the existing
semantic badge/status tokens (find them in the theme CSS via
`docs/knowledge/product-design.md`; if no semantic bg token exists for charts,
add `dark:` variants to the palette classes instead — smaller, honest fix).
Preserve each display's semantic meaning (error stays red-family).
**Verify**: build green; view affected charts in light AND dark (dev server or
component tests) — record before/after screenshots in the PR if feasible.

### Step 3: Relocate the three ui/ strays
Move `debounced-input.tsx`, `message-scroller.tsx`, `attachment.tsx` to
`components/` (e.g. `components/inputs/`, `components/assistant-ui/`); update
imports (`rg -l "ui/debounced-input|ui/message-scroller|ui/attachment" apps/dashboard/src`).
**Verify**: build green; `ls apps/dashboard/src/components/ui` contains only
shadcn primitives (spot-check against shadcn's registry names).

### Step 4: Update the design knowledge doc
Note the `CHART_BG_CLASSES` pattern and the ui/-folder rule clarification in
`docs/knowledge/product-design.md`; bump its `updated:` date (and the
`.claude/skills/product-design` skill if it mirrors this section).
**Verify**: doc diff present.

## Done criteria

- [ ] No runtime-constructed Tailwind class names in charts
- [ ] No un-themed palette classes in the four files (or dark: variants added)
- [ ] `components/ui/` contains only shadcn primitives
- [ ] Knowledge doc updated; build + tests green; `plans/README.md` updated

## STOP conditions

- assistant-ui's documented setup REQUIRES its components under `components/ui`
  (check assistant-ui docs/config before moving `message-scroller`/`attachment`)
  — if so, leave those two, move only `debounced-input`, and document the
  exception.

## Maintenance notes

- Reviewer: dark-mode screenshots for Step 2; imports-only diff for Step 3.
