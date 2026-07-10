# Plan 81: Fix chart tooltip breakdown color mismatch and unsafe value rendering

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/components/charts/primitives/tooltip-breakdown-section.tsx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (charts)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2498

## Why this matters

The breakdown section of chart tooltips colors its legend dots with
`var(--chart-${10 - index})` — descending from `--chart-10` — while the series
themselves are colored ascending (`--chart-${index + 1}`, see
`primitives/area.tsx` ~line 207 and `primitives/bar/utils.ts` ~line 66). So the
dot never matches the series it labels, and for index ≥ 10 the expression
yields undefined variables (`--chart-0`, `--chart--1`) — invisible dots. The
same component renders `value.toLocaleString()` on an `any`-typed value (throws
on undefined/objects) and contains a dead empty `<span>`.

## Current state

`apps/dashboard/src/components/charts/primitives/tooltip-breakdown-section.tsx`
(~lines 60-81):

```tsx
<TooltipColorIndicator
  colorVar={`var(--chart-${10 - index})`}
  size="small"
/>
...
{value.toLocaleString()}
<span className="text-muted-foreground font-normal"></span>
```

Props in this module are typed `any` (`breakdownData`/`item`/`value`, ~lines
8-11, 49-52). Design tokens: `--chart-1` … `--chart-13` (see the theme CSS /
`docs/knowledge/product-design.md`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests | `cd apps/dashboard && bun test src/components/charts` | all pass |

## Scope

**In scope**: `tooltip-breakdown-section.tsx` only (+ its new test).

**Out of scope**: series color assignment in `area.tsx` / `bar/utils.ts`
(correct); the `TooltipColorIndicator` component.

## Git workflow

- Branch: `advisor/81-tooltip-breakdown-fixes`
- Commit: `fix(charts): match tooltip breakdown dot colors to series, guard value rendering`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Match the series color convention
Replace the colorVar with the ascending, modulo-wrapped form used by the series
renderers. Read `primitives/area.tsx:200-215` and `primitives/bar/utils.ts:60-70`
first and copy their exact index→token arithmetic (including the modulo bound —
if they use `% 10`, use `% 10`).
**Verify**: `rg -n "10 - index" apps/dashboard/src/components/charts` → no matches.

### Step 2: Guard the value + remove dead markup
`typeof value === 'number' ? value.toLocaleString() : String(value ?? '')`;
delete the empty span. Replace the module's `any` props with minimal typed
shapes (`Record<string, unknown>` items, `number | string | null | undefined`
value) — do not over-engineer.
**Verify**: `pnpm run build` exit 0 (the typing must satisfy existing callers).

### Step 3: Test
New `tooltip-breakdown-section.test.tsx` (or pure-helper test if you extract
`breakdownColorVar(index)`): index 0 → same token as series index 0; index 12
wraps within defined tokens; non-numeric value renders without throwing.
Model rendering tests on any existing chart `.test.tsx`/`.cy.tsx` in
`src/components/charts` (check which runner is used for component tests —
prefer a pure-helper bun test if rendering infra is Cypress-only).
**Verify**: `bun test src/components/charts` → pass.

## Done criteria

- [ ] Dot color arithmetic identical to series arithmetic (single shared helper preferred)
- [ ] No `any` props in the module; non-numeric values safe
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- Series renderers use *different* arithmetic from each other (area vs bar) —
  report the inconsistency; don't pick one silently.

## Maintenance notes

- If chart token count changes (currently 13), only the shared modulo needs
  updating — keep it a named constant.
