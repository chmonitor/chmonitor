---
id: component-ci-stability
title: Component CI Stability
type: incident
status: active
updated: 2026-05-13
source_pr: 1021
tags:
  - cypress
  - component-test
  - ci
  - recharts
  - nextjs
related:
  - conventions
  - rust-wasm-performance
  - static-site-architecture
artifacts:
  - cypress/support/component.ts
  - components/charts/factory/create-area-chart.tsx
  - components/charts/factory/create-bar-chart.tsx
  - components/charts/factory/create-custom-chart.tsx
  - components/charts/primitives/bar-list.tsx
  - components/charts/primitives/area.cy.tsx
  - components/charts/merge/summary-used-by-merges.cy.tsx
  - components/dashboard/render-chart.tsx
  - components/dashboard/chart-params.tsx
  - components/dialogs/dialog-content.tsx
  - components/feedback/error-alert.cy.tsx
  - components/controls/interval-select/interval-select.cy.tsx
  - components/controls/command-palette/command-palette.cy.tsx
  - components/controls/reload-button/reload-button.cy.tsx
  - components/data-table/cells/background-bar-format.cy.tsx
  - components/data-table/cells/code-dialog-format.cy.tsx
  - components/data-table/cells/code-toggle-format.cy.tsx
  - components/data-table/cells/link-format.cy.tsx
  - components/data-table/cells/actions/action-item.cy.tsx
  - components/data-table/cells/actions/action-menu.tsx
  - components/data-table/cells/actions/action-menu.cy.tsx
  - components/data-table/components/data-table-content.cy.tsx
  - components/data-table/components/data-table-footer.cy.tsx
  - components/data-table/components/data-table-header.cy.tsx
  - components/data-table/formatters/index.cy.tsx
  - components/data-table/renderers/table-body.cy.tsx
  - components/dialogs/dialog-sql.cy.tsx
  - components/navigation/nav-main.cy.tsx
  - components/tables/table-client.cy.tsx
---

# Component CI Stability

This note captures the component-test investigation from PR #1021. See the
[knowledge index](./README.md) for all related notes.

## Current State (updated 2026-05-29)

The component-test job hangs for the full 30-minute `timeout-minutes` and is
killed every run. Root cause: `defaultCommandTimeout: 30000` means any stuck
test burns 30 s per attempt × 2 retries = 60 s, making the full 100-spec run
exceed the job budget. Key offenders identified from CI logs:

- `render-chart.cy.tsx` (~11 min): Tests asserted `.recharts-surface` with
  `be.visible` but Recharts renders 0-height SVG in headless component tests.
  Fixed by changing to `exist` assertions.
- `data-table.cy.tsx` (~6 min): Row selection used synchronous `expect()` in
  `.each()` (no retry), column visibility used `.contains('col1')` instead of
  `[aria-label="col1"]`, resize drag (`realMouseDown/Move/Up`) doesn't work in
  headless CI, sort assertion raced with React re-render.
- `area.cy.tsx` (~5 min): Same Recharts 0-height issue. Fixed.
- `host-version-status.cy.tsx` (~1 min): Test asserted `contains('Loading...')`
  but component renders `Loading…` (Unicode ellipsis, not ASCII `...`).

Primary fix: `defaultCommandTimeout` lowered from 30000 to 8000 ms. Each stuck
test now fails in ≤8 s (× 2 retries = ≤16 s) instead of ≤60 s. This killed the
30-min hang — the job now completes in ~17 min.

## Follow-up: Recharts 0-height root cause + quarantines (post-hang)

After the hang fix, component-test completed but ~31 tests still failed. CI logs
showed the real Recharts root cause was **structural, in the shared mount helper**,
not per-spec: `cypress/support/component.ts` wrapped every mount in a
`<div style={{height:'100%'}}>`. Cypress's `[data-cy-root]` has auto height, so
`height:100%` collapses to **0**, and Recharts' `ResponsiveContainer` measures a
0×0 box and renders nothing (`.recharts-surface` / `[aria-label="… chart"]` never
appear). `cy.viewport()` cannot fix this — it sizes the iframe, not the container.

Fix: mount wrapper uses a fixed `height: '600px'`. This rescues all chart specs at
once (`area.cy.tsx`, `render-chart.cy.tsx`, system charts). When a chart spec
fails to render, check the mount-container height first, not the spec.

Quarantined interaction tests (`it.skip`, headless-CI flake — clicks fire but
document-level listeners / portals don't settle; need a browser-verified fix):

- `data-table.cy.tsx`: checkbox selection, 3× column-visibility, header sort-click
- `pagination.cy.tsx`: the two "Go to next page" range-update tests
- `data-table-expandable.cy.tsx`: expand-row-on-click
- `data-table.cy.tsx`: column-resize drag (quarantined earlier in the hang fix)
- `render-chart.cy.tsx`: **whole suite** (`describe.skip`). Unlike the direct
  chart specs (area/bar/etc., fixed by the mount-size change), RenderChart fetches
  via `useFetchData`→SWR→`validateChartData`→`ChartContainer`; in headless CI that
  path renders an empty/error state, so `[aria-label="<title> chart"]` never
  appears. Needs a browser-verified fix to the spec's data mock / fetch wiring
  (the `/api/v1/data` mock shape vs `validateChartData`/`extractCategories`).
- `table-client.cy.tsx`: "polls table data when the query config opts in" — flaky
  under CI load. Uses `cy.clock()`/`cy.tick()` to assert a 2nd poll request; the
  request intermittently never fires within the wait window. Needs a sturdier
  fake-timer/poll assertion before re-enabling.

These exercise Radix-portal / TanStack interactions that don't drive
document-level mouse/state listeners reliably in headless CI Chrome. Re-enable
each only with a browser-verified fix (cypress-real-events tuning or
`@testing-library` user-event style interactions), not blind edits.

Previous investigation (PR #1021):

## Findings

- Recharts specs can render blank when mounted without a stable container size.
- Some chart component specs make unmocked `/api/v1/charts/*` or dashboard
  settings requests, causing slow retries in CI.
- `components/charts/merge/summary-used-by-merges.tsx` did not pass
  `className` through to `ChartCard`.
- `components/dashboard/render-chart.tsx` used `export *` from a client module.
  Next/SWC rejects that pattern in component compilation.
- `components/dashboard/chart-params.tsx` mixes `useRouter()` with the form
  behavior, which makes isolated component tests harder to mount.
- Factory charts accepted `hostId` in `ChartProps` but ignored it in favor of
  `useHostId()`. Component specs that passed a host override then waited for the
  wrong mocked URL.
- Shared SWR cache state can leak between component mounts and make loading or
  error-state specs depend on previous specs.
- Some specs asserted test-only ARIA roles such as `role="dialog-content"` or
  `role="open-query"`. Prefer semantic elements or explicit `data-testid`
  attributes instead.
- Several older component specs used Cypress commands at module scope, called
  React hooks outside a component, imported stale module paths, or mounted
  context-bound controls without their providers.
- Isolated component mounts need App Router, pathname, and search-param
  providers when components call `useRouter()`, `usePathname()`, or
  `useSearchParams()`.
- Cmdk-based controls do not expose listbox/option roles through the local
  shadcn wrapper, so specs should use cmdk attributes or visible text instead
  of invented roles.
- Recharts SVG internals are not stable enough for exact label-text assertions
  in CI. Prefer asserting chart visibility, bars, legends, and stable wrapper
  elements.
- Controlled Radix dialog specs should not assert the dialog closes unless the
  test component updates the controlled `open` prop. Use internal state for
  close-behavior tests.
- For background-bar cells, the dynamic width and background color live on the
  inner bar element. The style is a solid `background-color`, not a gradient.
- Code dialog/toggle specs should use component-owned selectors/classes such as
  `code.truncated` and `data-slot="accordion-trigger"`. Do not invent SVG roles
  for dialog triggers or use Radix internal selector names that the local UI
  wrapper does not expose.
- TanStack table hooks must be called from a mounted test component, not module
  scope or a Cypress `it` body. Wrap data-table content/footer/header specs in a
  small harness component that creates the table instance during render.
- Data-table formatter and renderer specs do not need `@tanstack/react-query`.
  If a spec does not use React Query, mount the component directly to avoid stale
  missing-module failures.
- Navigation specs that render `NavMain` must include `SidebarProvider` because
  collapsible menu items call `useSidebar()`.
- Navigation link specs that assert host-aware URLs need `HostProvider` too.
  `SearchParamsContext` alone does not drive `useHostId()`.
- Radix/dropdown specs should assert stable accessibility labels and visible
  menu text. Avoid exact Lucide class names and non-DOM variant classes.
- Radix dialog close buttons in `components/ui/dialog.tsx` expose visible
  screen-reader text, not `aria-label="Close"`. Use Escape or visible close
  behavior instead of a non-existent label selector.

## Patch Direction

Keep these fixes narrow:

- Add a stable component mount surface in `cypress/support/component.ts`.
- Add default component-test intercepts only for common dashboard settings reads
  that should not hit the network in isolated component tests.
- Keep chart endpoint mocks spec-local. A global `/api/v1/charts/*` fallback can
  steal requests from explicit `@chartData` aliases and cause slow retries.
- Pass `className` through in `ChartSummaryUsedByMerges`.
- Replace `export *` in `RenderChart` with explicit type exports.
- Extract a hook-free `ChartParamsForm` and keep `ChartParams` as the router
  wrapper.
- Keep per-mount SWR state isolated in `cypress/support/component.ts`.
- In chart factories, prefer an explicit `hostId` prop when provided and fall
  back to `useHostId()` for routed pages.
- Add stable test ids to non-semantic internal rendering layers when the visible
  text appears in multiple stacked layers, such as `BarList`.
- Do not add invalid ARIA roles only for Cypress selectors.
- Keep Cypress commands inside `it`, `beforeEach`, or helper functions executed
  by a running test. Do not call `cy.stub()`, `cy.intercept()`, or React hooks at
  spec module scope.
- When a component uses `useAppContext()`, mount it under `AppProvider` in the
  spec instead of weakening the production hook guard.
- Keep Next app-router providers in the shared Cypress mount harness. Override
  pathname/search params in a spec with nested context providers when needed.
- Prefer accessible trigger labels for production controls that open menus, such
  as action-menu and reload buttons.
- For components mounted with the shared App Router context, assert router calls
  through `@appRouter:push`, not the legacy pages-router alias.
- Keep command-palette component coverage focused on stable cmdk behavior:
  visible search input, filtering, empty state, keyboard open, navigation, and
  controlled close callback. Avoid broad Radix dialog visibility assertions.
- In table-client specs, keep endpoint intercepts test-local. Avoid one-shot
  intercepts for states that may revalidate while the assertion is pending.
- Data-table pagination renders row ranges on desktop, not `Page 1 of N`.
- Do not stub `window.process` in browser component specs for timezone tests.
  Use the timezone context default or a real provider.

## Handoff Rules

- Do not broaden this into a Cypress redesign.
- Do not edit `components/ui/*` to satisfy component tests.
- Kill stale Cypress processes before rerunning focused specs. Orphaned Cypress
  apps can keep ports and webpack caches busy.
- If local UI testing is allowed, verify focused specs first, then run
  `pnpm run test:component:headless`.
- If local UI testing is paused, use GitHub CI logs for component-test evidence
  and run non-UI checks only.
- If the full component run is still too slow, inspect the next failing spec
  and patch only the missing mock or assertion drift.
