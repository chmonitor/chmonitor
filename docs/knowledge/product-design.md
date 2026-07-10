---
id: product-design
title: Product design system & UX conventions
type: reference
status: active
updated: 2026-07-10
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

**Series-color arithmetic (one helper).** `area.tsx`, `bar/utils.ts`
(`colorForCategoryIndex`), and `donut.tsx` all resolve a series/category color
through the shared `seriesColorVar(index, colors?)` in
`components/charts/primitives/series-color.ts`: an explicit `colors` list when
given, else `var(--chart-1..13)` ascending, else golden-angle HSL hue rotation
beyond the 13 defined tokens. Don't reintroduce a fourth per-primitive
arithmetic — add overflow handling to `seriesColorVar` instead.

**`bg-chart-N` fallback fills must be static literals.** `ProportionList`
(`components/charts/primitives/proportion-list.tsx`) and its chart consumers
(`query-type.tsx`, `log-level-distribution.tsx`, `query-cache-usage.tsx`) pick
a fallback fill class from the shared `CHART_BG_CLASSES` array
(`components/charts/chart-bg-classes.ts`) — never build `` `bg-chart-${n}` ``
at runtime. Tailwind's content scanner only emits classes it can see as
literals in source; a template string is invisible to it and gets purged from
the production bundle (it happened to "work" in dev only because another
file's own literal list kept the classes alive network-wide). Palette-class
status colors (error/warn/ok swatches in these same files, plus
`system/disk-usage.tsx`) carry an explicit `dark:` variant
(`bg-red-500 dark:bg-red-400`-style) since they intentionally bypass the
`--chart-N` tokens for semantic meaning.

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

**`components/ui/` is for pristine shadcn CLI output only** — no app-specific
component belongs there (an import of an app hook/lib is the tell). Bespoke
components that only *look* like they belong (e.g. `debounced-input.tsx`,
which pulled in `@/lib/hooks`) live under `src/components/` instead — moved to
`components/inputs/debounced-input.tsx`. Exception: assistant-ui's documented
setup expects its companion pieces (`message-scroller.tsx`, `attachment.tsx`)
under `components/ui/`, so those stay put.

**Base UI backing (post-#2361).** The primitives are the shadcn **Base UI**
(`@base-ui/react`) distribution, not Radix. When adding/upgrading a primitive or
writing overlay CSS, remember Base UI's contract differs from Radix in ways
`tsc` cannot catch (they live only in `className` strings and keyframes) — this
caused a class of silent runtime breakage in #2361/#2363/#2364:

- **Orientation is a value, not a boolean.** Base UI emits
  `data-orientation="horizontal|vertical"`. The shadcn components style off
  `data-horizontal:` / `data-vertical:` variants, which require the
  `@custom-variant data-horizontal (&[data-orientation='horizontal'])` (and
  vertical) declarations in `styles.css`. Without them Tailwind v4 compiles
  `data-horizontal:` to `&[data-horizontal]`, which never matches → tabs /
  separator / scroll-area / button-group get the wrong flex axis.
- **State is boolean attributes, not `data-state`.** Base UI popups emit
  `data-open` / `data-closed` (use `data-open:` / `data-closed:`), never
  `data-[state=open]`. Collapsible trigger emits `data-panel-open`.
- **CSS vars are renamed.** `--radix-*` → Base UI names: menu/popover width
  `--anchor-width`, popover available height `--available-height`, accordion
  `--accordion-panel-height`, collapsible `--collapsible-panel-height`. A stale
  `--radix-*` reference silently drops the animation/layout it drove.
- **`asChild` → `render`.** Base UI uses a `render` prop, not `asChild`.
- Ground-truth attribute/var names live in
  `node_modules/@base-ui/react/**/*DataAttributes.js` / `*CssVars.js`.

## Anti-patterns ("AI slop")

Signals that a component was over-decorated rather than designed — each of
these adds a channel that duplicates a signal another element already carries.
Prefer ONE clear signal per piece of state, not several redundant ones.

- **No decorative full-saturation accent bars/rails on cards.** A colored
  left/top border stripe on top of an already-colored card border is
  redundant — severity should already read from the border color, a status
  pill/badge, and/or the value color. Incident: `health-card-shell.tsx` had
  both a subtle `border-amber-500/30` AND a full-opacity 3px left rail for
  the same warning state — the rail was removed, the border alone carries it.
- **No gradient blobs / glow orbs behind icons or headers** unless the brand
  system itself uses them (it doesn't — see Brand below). A plain icon in a
  bordered square (`InsightsGlyph` pattern) reads cleaner than a soft-glow
  circle.
- **Don't stack more than one severity/status signal per element** — pick the
  cheapest that reads clearly (usually: border/text color + a labeled pill).
  Sparklines, icons, and badges are fine in combination when each carries
  *different* information (trend vs. category vs. severity), not the same one
  restated.
- **Prefer the design system's existing idiom over inventing a new visual
  language.** Before adding a new card treatment, dialog style, or badge
  variant, grep for an existing one in `components/` — see "Canonical idioms"
  in the `product-design` skill.

## Component patterns

- **Charts:** `ChartContainer` (`components/charts/chart-container.tsx`) handles
  skeleton/error/empty; `ChartCard` (`components/cards/chart-card.tsx`) provides
  title, SQL view, `CardToolbar` metadata (queryTime/rowsRead/data sizes), stale
  indicator, retry, optional date-range + log-scale. Fetch with `useChartData`
  (`lib/swr/use-chart-data.ts`). Card styles centralised in
  `components/charts/chart-card-styles.ts`.
- **Anomaly overlay (Statistics Insights):** the `AreaChart` primitive takes an
  opt-in `anomalyOverlay: { category }` prop (`types/charts.ts`). When set, it
  draws a trailing moving-average line + ±k·σ band (a `fill:none` Area is the
  line — recharts' `AreaChart` ignores `<Line>` children) and flags out-of-band
  points with a custom Area `dot` (this recharts build can't resolve
  `<ReferenceDot>`), plus an optional absolute threshold `ReferenceLine`. The
  band uses a **prior-only window** (excludes the current point) so a spike can't
  mask its own anomaly. Params/visibility come from `useStatsInsightsSettings`
  (localStorage + CustomEvent, mirrors `useInsightsSettings`); the pure math +
  tests live in `lib/insights/anomaly-overlay.ts`. Undefined prop ⇒ zero change
  for every other area chart. Enabled on the `/queries/insights` charts.
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
- **Severity-tiered "many checks at a glance":** don't give every item equal
  visual weight. Items that need attention expand to full cards; healthy/normal
  items collapse into ONE dense, quiet bordered list (`divide-y … rounded-xl
  border`) of `[status dot] [muted icon] [title] [sublabel] [value] [chevron]`
  rows — no per-row sparkline (a flat healthy trend is decoration). Partition the
  already severity-sorted, filter-narrowed list into cards vs rows so the same
  split also drives the filter tabs. Keep the aggregate banner restrained: a
  subtle tint plus the colored icon + title carry the severity — NO left accent
  rail (a saturated rail reads as slop; removed 2026-07-05), no saturated fill,
  no count pills (let the tabs carry the counts). Reference:
  `components/health/{health-grid,health-card-shell,health-summary-banner}.tsx`
  (`HealthCardShell` `variant: 'card' | 'row'`).
- Graceful revalidation: keep data on `staleError`, show hover-revealed amber
  `ChartStaleIndicator`; only blank out on initial `error && !hasData`.
- Icons: `lucide-react`, `size-4` / `size-3.5`, `strokeWidth={1.5}`.
- Class idioms: card `rounded-xl border bg-card shadow-sm`; dense text
  `text-[13px]`; meta `text-xs text-muted-foreground`; hero title `text-xl
  font-semibold tracking-tight`.
- **Paired page sections (e.g. AI-generated vs. plain-statistics content):**
  give each section an identical-weight header — `icon (size-4, muted-foreground)
  + <h2 className="text-sm font-medium text-foreground">` — never let one
  section get a bold heading and the other just a bare CTA banner; that reads as
  one being an afterthought. If a section genuinely has no content/settings yet,
  render a labeled placeholder (`EmptyState variant="no-data" compact` inside a
  `Card`) rather than omitting the section. Reference: `/insights` (`AI Insights`
  vs `Cluster Statistics`) and `/insights-settings` (`AI Insights` vs
  `Statistics Insights`, now a real `StatsInsightsSettingsForm`) —
  `components/insights/insights-panel.tsx`,
  `routes/(dashboard)/insights-settings.tsx`.
- **Preview / "Example" surfaces must not depend on live infra or an LLM.** A
  settings-page example, template gallery, or onboarding sample should render
  from deterministic mock data parameterized by the current settings — never a
  live query or model call that shows a scary "Couldn't generate — cluster
  unreachable/read-only" error to an anonymous or read-only visitor. Keep it
  seed-rotated (not `Math.random()`) so it's SSR-safe, and label it (a "Sample"
  badge + a one-line footnote that it's illustrative, not live analysis).
  Reference: `components/insights/insights-preview.tsx` +
  `lib/insights/mock-preview.ts`.
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
(live/health). For a real upstream brand (PeerDB, …), draw an inline SVG in
`components/icons/` like `peerdb-brand-logo.tsx`. When no real logo is
available/appropriate to fabricate (e.g. third-party LLM providers in the
agent settings Provider & Models tab), fall back to a colored circular
lettermark (first letter, provider's existing accent color) rather than
inventing a low-quality logo — see `ProviderMark` in
`components/agents/settings/provider-models-tab.tsx`.

## File / naming

kebab-case files; PascalCase components; `use*` hooks; `'use client'` on
interactive client components; shared types in `src/types/` or
`src/lib/api/types.ts`; route pages under `src/routes/(dashboard)/`; nav in
`src/menu.ts`. See `conventions.md`.
