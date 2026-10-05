---
id: component-ci-stability
title: Component CI Stability
type: incident
status: active
updated: 2026-10-05
source_pr: 1021
tags:
  - cypress
  - component-test
  - ci
  - recharts
related:
  - conventions
  - rust-wasm-performance
  - static-site-architecture
artifacts:
  - apps/dashboard/cypress.config.ts
  - apps/dashboard/cypress/support/component.ts
  - apps/dashboard/src/components/data-table/__tests__/data-table.cy.tsx
  - apps/dashboard/src/components/postgres/__tests__/pg-extension-empty-state.cy.tsx
---

# Component CI Stability

> **THE `component-test` CI JOB NO LONGER EXISTS.** It was decommissioned in
> `4db358cf` (#1623, 2026-06-15), which deleted the job from
> `.github/workflows/test.yml` and the `component` block from the Cypress
> config. The legacy Next.js dashboard that owned most of its specs was deleted
> earlier, in `441a0922` (#1613, 2026-06-14). **Nothing in CI runs Cypress
> component tests today, and no CI log exists to read.** Local component
> testing still works: `apps/dashboard/cypress.config.ts` keeps its `component:`
> block, and two specs survive.

This note records the `component-test` investigation from PR #1021. It is kept
as an incident record: the CI job is gone, but the **lessons it produced are
still live**, and two component specs still run locally against them. See the
[knowledge index](./README.md) for all related notes.

## What still applies today

These are the parts that outlived the job. Verify them before writing any new
component spec.

- **`defaultCommandTimeout` budget math.** A stuck test burns
  `defaultCommandTimeout × (1 + retries)`. At the Cypress default of 30 s with
  one retry that is 60 s per stuck test, which is what turned a broken spec into
  a 30-minute job timeout. `apps/dashboard/cypress.config.ts` now sets
  `defaultCommandTimeout: 8000` (plus `requestTimeout: 10000`,
  `responseTimeout: 15000`, `pageLoadTimeout: 60000`) — the fix from this
  incident is still in the config, so keep it there.
- **Recharts renders nothing at 0 height.** `ResponsiveContainer` measures its
  own box; at 0×0 it emits no `.recharts-surface` and no
  `[aria-label="<title> chart"]`, so `be.visible` assertions fail against a chart
  that "didn't render". It is a layout fact, not a Recharts bug. The old harness
  in `apps/dashboard/cypress/support/component.ts` was the cause for a while — it
  wrapped every mount in a `height: '100%'` div, which collapses to 0 inside
  Cypress's auto-height `[data-cy-root]`. That harness is **gone**: the support
  file is now a plain `cypress/react` mount helper. So a new chart spec must
  supply its own sized container, and `cy.viewport()` is not a substitute — it
  sizes the iframe, not the container.
- **`useHostId()` reads the router search param, not a host context.** Host-aware
  URL assertions need `?host=` in the search params.
- **`useSidebar()` needs `SidebarProvider`.** Collapsible nav items call it, so
  any spec mounting them must wrap them in the provider.
- **Build table instances inside a mounted component.** TanStack table hooks
  (`useReactTable`) must run during render, not at spec module scope or inside an
  `it` body. `DataTablePagination` accepts the instance as a prop precisely so a
  spec can build it in a small harness component.
- **Cypress commands belong inside a running test.** `cy.intercept()`,
  `cy.stub()`, and React hooks must not be called at spec module scope — put them
  in `it`, `beforeEach`, or a helper the test calls.
- **Keep endpoint mocks spec-local.** A global `/api/v1/charts/*` intercept
  fallback can steal requests from an explicit `@chartData` alias and cause slow
  retries.
- **Do not invent ARIA roles or assert test-only ones.** Prefer semantic
  elements, visible text, or an explicit `data-testid`. Asserting
  `role="dialog-content"`, a non-DOM variant class, or an `aria-label` the
  control does not expose produces a spec that fails on markup, not behavior.
- **Assert stable wrappers, not chart SVG internals.** Recharts internals are not
  stable enough for exact label-text assertions.

## The specs that exist today

Two, both provider-light and neither a chart spec:

- `apps/dashboard/src/components/data-table/__tests__/data-table.cy.tsx` —
  `DataTablePagination` driven by a real `useReactTable` instance built inside a
  harness component; pagination, row counts, page size, and the synthetic
  `__expand` / `select` column ARIA invariants. Needs no router provider.
- `apps/dashboard/src/components/postgres/__tests__/pg-extension-empty-state.cy.tsx` —
  the graceful empty state when `pg_stat_statements` is missing (issue #2450):
  extension name plus the `shared_preload_libraries` / `CREATE EXTENSION` steps.

Run them locally, not in CI:

```sh
pnpm run test:component          # interactive, all component specs
pnpm run test:component:headless # headless
```

`apps/dashboard/cypress.config.ts` picks specs up from
`specPattern: 'src/**/*.cy.tsx'` with
`supportFile: 'cypress/support/component.ts'`. Adding a third spec means adding
it under `apps/dashboard/src/**/*.cy.tsx` — it will not be gated by any CI job.

## CI job history (decommissioned)

Kept as history. There is no CI job to re-run and no CI log to read; the record
below is what the investigation found in 2026-05-29, before the job was deleted
in `4db358cf`.

**The hang.** The job hung for the full 30-minute `timeout-minutes` and was
killed every run. Root cause: `defaultCommandTimeout: 30000` meant any stuck test
burned 30 s per attempt × 2 retries = 60 s, making the full ~100-spec run
exceed the job budget. Primary fix: lower the timeout to 8000 ms, so each stuck
test fails in ≤8 s (× 2 retries = ≤16 s) instead of ≤60 s. That ended the hang —
the job completed in ~17 min before it was deleted.

Slowest offenders, measured from the CI logs of that run:

- `render-chart.cy.tsx` (~11 min): asserted `.recharts-surface` with
  `be.visible`, but Recharts renders 0-height SVG in headless component tests.
  Fixed by changing to `exist` assertions.
- `data-table.cy.tsx` (~6 min): row selection used synchronous `expect()` in
  `.each()` (no retry), column visibility used `.contains('col1')` instead of
  `[aria-label="col1"]`, resize drag (`realMouseDown/Move/Up`) does not work in
  headless CI, and the sort assertion raced with React re-render.
- `area.cy.tsx` (~5 min): same Recharts 0-height issue. Fixed.
- `host-version-status.cy.tsx` (~1 min): asserted `contains('Loading...')` but
  the component renders `Loading…` (Unicode ellipsis, not ASCII `...`).

**After the hang fix.** ~31 tests still failed. The real Recharts root cause was
structural, in the shared mount helper rather than in any one spec — see the
0-height bullet above. Changing the wrapper to a fixed `height: '600px'` rescued
all chart specs at once (`area.cy.tsx`, `render-chart.cy.tsx`, system charts).
Lesson: when a chart spec fails to render, check the mount-container height
first, not the spec.

**Quarantined specs** (`it.skip`, headless-CI flake — clicks fire but
document-level listeners and portals do not settle). All of these specs were
deleted with the legacy Next.js app; the list is history, not a to-do:

- `data-table.cy.tsx`: checkbox selection, 3× column-visibility, header sort-click
- `pagination.cy.tsx`: the two "Go to next page" range-update tests
- `data-table-expandable.cy.tsx`: expand-row-on-click
- `data-table.cy.tsx`: column-resize drag (quarantined during the hang fix)
- `render-chart.cy.tsx`: **whole suite** (`describe.skip`). Unlike the direct
  chart specs, RenderChart fetches via `useFetchData` → SWR →
  `validateChartData` → `ChartContainer`; in headless CI that path renders an
  empty/error state, so `[aria-label="<title> chart"]` never appeared. Needed a
  browser-verified fix to the spec's data mock / fetch wiring.
- `table-client.cy.tsx`: "polls table data when the query config opts in" —
  flaky under CI load. `cy.clock()`/`cy.tick()` asserted a second poll request
  that intermittently never fired within the wait window.

These exercised Radix-portal / TanStack interactions that do not drive
document-level mouse/state listeners reliably in headless CI Chrome.

## Findings — legacy Next.js era (historical)

Every path in this list was deleted with the Next.js app in `441a0922`
(#1613). Kept because the *reasoning* transfers; the files do not exist. Do not
go looking for them — nothing named `components/dashboard/render-chart.tsx` or
`components/dashboard/chart-params.tsx` exists under any directory.

- Recharts specs can render blank when mounted without a stable container size.
- Some chart component specs made unmocked `/api/v1/charts/*` or dashboard
  settings requests, causing slow retries in CI.
- `apps/dashboard/src/components/charts/merge/summary-used-by-merges.tsx` did not
  pass `className` through to `ChartCard`.
- `components/dashboard/render-chart.tsx` used `export *` from a client module;
  Next/SWC rejects that pattern in component compilation.
- `components/dashboard/chart-params.tsx` mixed `useRouter()` with the form
  behavior, which made isolated component tests harder to mount.
- Factory charts accepted `hostId` in `ChartProps` but ignored it in favor of
  `useHostId()`, so component specs that passed a host override waited for the
  wrong mocked URL.
- Shared SWR cache state could leak between component mounts and make
  loading- or error-state specs depend on previous specs.
- Some specs asserted test-only ARIA roles such as `role="dialog-content"` or
  `role="open-query"`. Prefer semantic elements or explicit `data-testid`.
- Several older specs used Cypress commands at module scope, called React hooks
  outside a component, imported stale module paths, or mounted context-bound
  controls without their providers.
- Isolated mounts needed App Router, pathname, and search-param providers when a
  component called `useRouter()`, `usePathname()`, or `useSearchParams()`.
- Cmdk-based controls do not expose listbox/option roles through the local shadcn
  wrapper, so specs should use cmdk attributes or visible text.
- Controlled Radix dialog specs should not assert the dialog closes unless the
  test component updates the controlled `open` prop; use internal state for
  close-behavior tests.
- For background-bar cells, the dynamic width and background color live on the
  inner bar element. The style is a solid `background-color`, not a gradient.
- Code dialog/toggle specs should use component-owned selectors/classes such as
  `code.truncated` and `data-slot="accordion-trigger"`, not SVG roles or Radix
  internal selector names the local UI wrapper does not expose.
- Radix dialog close buttons in `apps/dashboard/src/components/ui/dialog.tsx`
  expose visible screen-reader text, not `aria-label="Close"`. Use Escape or
  visible close behavior.
- Data-table pagination renders row ranges on desktop, not `Page 1 of N`.
- Do not stub `window.process` in browser specs for timezone tests; use the
  timezone context default or a real provider.
- Components using `useAppContext()` must be mounted under `AppProvider` in the
  spec rather than weakening the production hook guard.

## Patch Direction (historical)

What was actually applied, for reference. Most of it no longer exists; the
surviving equivalent is "add a stable mount surface in the support file" and
"keep chart mocks spec-local".

- Add a stable component mount surface in
  `apps/dashboard/cypress/support/component.ts`.
- Add intercepts only for common dashboard settings reads that should not hit
  the network in isolated component tests.
- Keep chart endpoint mocks spec-local. A global `/api/v1/charts/*` fallback can
  steal requests from explicit `@chartData` aliases and cause slow retries.
- Pass `className` through in `ChartSummaryUsedByMerges`.
- Replace `export *` in `RenderChart` with explicit type exports.
- Extract a hook-free `ChartParamsForm` and keep `ChartParams` as the router
  wrapper.
- Keep per-mount SWR state isolated in the support file.
- In chart factories, prefer an explicit `hostId` prop when provided and fall
  back to `useHostId()` for routed pages.
- Add stable test ids to non-semantic internal rendering layers when the visible
  text appears in multiple stacked layers, such as `BarList`.
- Do not add invalid ARIA roles only for Cypress selectors.
- Keep Cypress commands inside `it`, `beforeEach`, or helper functions executed
  by a running test.
- Keep the App Router providers in the shared mount harness; override
  pathname/search params per spec with nested context providers when needed.
- Prefer accessible trigger labels for production controls that open menus, such
  as action-menu and reload buttons.
- Keep command-palette component coverage focused on stable cmdk behavior:
  visible search input, filtering, empty state, keyboard open, navigation, and
  controlled close callback.
- In table-client specs, keep endpoint intercepts test-local; avoid one-shot
  intercepts for states that may revalidate while the assertion is pending.

## Handoff Rules

- Do not broaden this into a Cypress redesign.
- Do not edit `components/ui/*` to satisfy component tests.
- Kill stale Cypress processes before rerunning focused specs. Orphaned Cypress
  apps keep ports and bundler caches busy.
- Verify focused specs first, then run `pnpm run test:component:headless`.
- **There is no CI component-test job, so there is no CI log to fall back on.**
  If local component runs are not possible, say so — do not claim CI evidence.
- If a component run is too slow, inspect the next failing spec and patch only
  the missing mock or assertion drift.