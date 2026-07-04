---
id: product-design
title: Product design system & UX conventions
type: reference
status: active
updated: 2026-07-04
tags:
  - design-system
  - ui
  - ux
  - tailwind
  - shadcn
  - tokens
related:
  - conventions
  - cluster-topology
  - cloud-saas-mode
---

# Product design system

The durable reference behind the `product-design` Claude skill
(`.claude/skills/product-design/`). New features should match these patterns.

## Theme tokens (OKLCH, CSS-first Tailwind v4)

Defined in `apps/dashboard/src/styles.css` via `@theme` blocks — **no
`tailwind.config.ts`**. Dark mode is `.dark` class (`next-themes`,
`attribute="class"`, `defaultTheme="system"`). Always use semantic tokens; they
flip automatically between themes.

Semantic tokens: `background foreground card card-foreground popover
popover-foreground primary primary-foreground secondary secondary-foreground
muted muted-foreground accent accent-foreground destructive border input ring`.

Light is a near-neutral grayscale (`--background: oklch(1 0 0)`, `--foreground:
oklch(0.145 0 0)`, `--border: oklch(0.922 0 0)`, `--muted-foreground:
oklch(0.556 0 0)`). Dark inverts (`--background: oklch(0.145 0 0)`, `--border:
oklch(1 0 0 / 10%)`).

Chart series: `--chart-1..5` in OKLCH (orange/blue/dark-blue/yellow-green/green),
plus HSL extras `--chart-6..13`. Semantic badge pairs exist as
`--badge-{purple,blue,green,amber,pink,slate}` + `*-bg`.

Radius: `--radius: 0.625rem` (10px) → `rounded-sm` 6px / `rounded-md` 9px /
`rounded-lg` 10px / `rounded-xl` 14px.

Fonts: Geist Variable (sans) + Geist Mono.

**OKLCH gotcha:** prefer `oklch(from var(--x) l c h)` for derived colors over
`hsl(var(--x))` — see `cluster-topology.md` for the dynamic-color lightness bug.

## shadcn/ui rule

Never edit `src/components/ui/*`. Customise via `className` at the call site or a
wrapper in `src/components/`. Merge with `cn()` (`src/lib/utils.ts` = clsx +
tailwind-merge). Primitives available: accordion, alert, avatar, badge,
breadcrumb, button, button-group, card, carousel, checkbox, collapsible, command,
dialog, drawer, dropdown-menu, empty-state, form, hover-card, icon-button, input,
input-group, label, popover, progress, resizable, scroll-area, select, separator,
sheet, sidebar, skeleton, tabs, tooltip (+ more).

## Component patterns

- **Charts:** `ChartContainer` (`components/charts/chart-container.tsx`) handles
  skeleton/error/empty; `ChartCard` (`components/cards/chart-card.tsx`) provides
  title, SQL view, `CardToolbar` metadata (queryTime/rowsRead/data sizes), stale
  indicator, retry, optional date-range + log-scale. Fetch with `useChartData`
  (`lib/swr/use-chart-data.ts`). Card styles centralised in
  `components/charts/chart-card-styles.ts`.
- **Data tables:** `components/data-table/` — resizing, wrap toggle, sorting
  (`sorting-fns.ts`), pagination, faceted filters, row actions, SQL display.
  Synthetic ids `__expand`/`select`/`action` are non-data.
- **Clickable table row → detail Sheet flyout:** `DataTable`'s `onRowClick`
  prop (threaded through `TableClient` → `QueryPageLayout`, desktop rows
  only — mutually exclusive with `expandable`, which owns row clicks when
  set) fires with the row's data when the click lands outside interactive
  cell content (same guard as inline expansion, `isRowClickTarget` in
  `renderers/table-body.tsx`). The page holds `useState` for the selected
  row + Sheet open flag and renders a `<Sheet>`-based detail component
  alongside `<PageLayout>`. Reference:
  `routes/(dashboard)/slow-query-patterns.tsx` +
  `components/slow-query-patterns/pattern-detail-sheet.tsx` — the Sheet's
  heavy content lives in a child component only mounted while `open` is
  true, so its data fetches don't run while the flyout is closed.
- **Empty:** `components/ui/empty-state.tsx`, variants `no-data | no-results |
  error | loading | offline | table-missing | timeout | filtered-empty`.
- **Skeletons:** `components/skeletons/` — match final layout (no layout shift).
- **First-run:** `components/host/first-run-gate.tsx` →
  `first-run-empty-state.tsx` (cloud signed-in / cloud anon / self-hosted).
- **Dashboard widget grid** (plan 57, `components/dashboard/`): `grid.tsx`
  lays out `DashboardWidget[]` (chart/table/stat/text, `@/types/dashboard-layout`)
  on a fixed 12-column CSS grid; view mode is plain positioned `div`s, arrange
  mode adds `@dnd-kit/core` drag-to-move + pointer-event corner resize, both
  rejecting (snap-back) a move/resize that collides with another widget
  (`widgetsCollide`/`findFreePosition`). `widget-frame.tsx` is the shared
  chrome (title bar, drag handle, remove, resize handle — edit-mode-only).
  A dashboard-scoped `DashboardTimeRangeProvider`
  (`components/dashboard/time-range-context.tsx`, distinct from the app-wide
  `lib/context/time-range-context.tsx`) drives every chart widget's baseline
  `lastHours`/`interval` via explicit props, which outrank both the chart's
  own default and the global header time-range picker.

## UX conventions

- `?host=N` routing; `useHostId()` (`lib/swr`); preserve params via
  `buildUrl(pathname, { host }, searchParams)`.
- Hooks at deepest consumer — no `hostId` prop drilling.
- **Clickable summary card → detail dialog:** make the WHOLE card the target
  (`role="button"` + `tabIndex={0}` + `onClick` + `onKeyDown={activateOnEnterOrSpace(open)}`
  from `lib/a11y.ts` — never a nested `<button>`); inner links call
  `e.stopPropagation()` (NOT `preventDefault`) so they still navigate. Reveal a
  hover/focus "Details" hint. Drive drill-down generically from a per-item field
  (e.g. each health check's `detailChartName`) rendered via `ResultTable`, not
  per-card code — see `components/health/{health-card-shell,health-detail-rows}.tsx`.
- Graceful revalidation: keep data on `staleError`, show hover-revealed amber
  `ChartStaleIndicator`; only blank out on initial `error && !hasData`.
- Icons: `lucide-react`, `size-4` / `size-3.5`, `strokeWidth={1.5}`.
- Class idioms: card `rounded-xl border bg-card shadow-sm`; dense text
  `text-[13px]`; meta `text-xs text-muted-foreground`; hero title `text-xl
  font-semibold tracking-tight`.
- Overflow strip: for a single-row scroller that must not wrap, use
  `scrollbar-hide overflow-x-auto` (util in `styles.css`; also on the overview
  tab bar) with `py-*` so card shadows/accents/focus rings aren't clipped
  vertically. When it overflows, show a chevron button + a
  `from-background`→`transparent` edge fade per scrollable side and page with
  `scrollBy({ left: ±clientWidth*0.85, behavior: 'smooth' })`; re-measure on
  scroll, `ResizeObserver`, and content-count change. Reference:
  `components/insights/insights-strip.tsx`.

## Brand

`components/icons/chmonitor-logo.tsx` — orange metric bars + emerald health cap.
Name "chmonitor" / "ClickHouse Monitor". Accents: orange (metrics), emerald
(live/health).

## File / naming

kebab-case files; PascalCase components; `use*` hooks; `'use client'` on
interactive client components; shared types in `src/types/` or
`src/lib/api/types.ts`; route pages under `src/routes/(dashboard)/`; nav in
`src/menu.ts`. See `conventions.md`.
