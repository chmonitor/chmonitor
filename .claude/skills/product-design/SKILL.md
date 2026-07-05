---
name: product-design
description: >-
  chmonitor's product design system + UX conventions, so every new feature looks
  and behaves consistent with the rest of the dashboard. Use BEFORE building or
  reviewing any UI: new pages, charts, cards, dialogs, empty/error/loading
  states, badges, onboarding, settings. Covers design tokens (OKLCH theme, dark
  mode, radius, chart colors), shadcn/ui rules, the ChartCard/ChartContainer
  pattern, data-table system, EmptyState variants, graceful error handling,
  ?host routing + hooks-at-deepest-consumer, file/route organization, and brand.
  Triggers: "new page", "add a chart", "build UI", "design", "component",
  "empty state", "loading", "consistent", "follow-up feature", "match the design".
metadata:
  tags: design-system, ui, ux, tailwind, shadcn, charts, tokens, conventions, brand
---

# chmonitor product design system

The rulebook for keeping new features visually + behaviourally consistent. When
in doubt, COPY the closest existing component rather than inventing. Full token
values and file paths: `docs/knowledge/product-design.md`.

## Non-negotiables

1. **Never edit `src/components/ui/*`** (shadcn primitives). Customise via the
   `className` prop at the call site, or a wrapper in `src/components/` — never
   in `ui/`. Always merge classes with `cn()` (`src/lib/utils.ts`), never
   template-literal concatenation.
2. **Tailwind v4, CSS-first.** Tokens live in `src/styles.css` `@theme` blocks —
   there is no `tailwind.config.ts`. Use semantic tokens (`bg-card`,
   `text-muted-foreground`, `border-border`), not raw colors. Theme is OKLCH.
3. **Dark mode is `class`-based** (`next-themes`, `.dark`). Every surface must
   read correctly in both themes — only use semantic tokens, which flip
   automatically. Don't hardcode `bg-white` / `text-black`.
4. **Hooks at the deepest consumer.** A component that needs data calls
   `useHostId()` / `useChartData()` itself — do NOT prop-drill `hostId`.
5. **`?host=N` routing**, never dynamic `/N/...` segments. Preserve other search
   params with `buildUrl(pathname, { host }, searchParams)`.

## Tokens (semantic — use these names, not hex/oklch literals)

`background foreground card card-foreground popover muted muted-foreground
primary secondary accent destructive border input ring`. Charts:
`--chart-1..5` (OKLCH) for series. Radius: `rounded-md` (9px) default,
`rounded-lg` (10px), `rounded-xl` (14px) for cards. Brand accents: **orange**
(metrics) + **emerald** (health/live) — see `components/icons/chmonitor-logo.tsx`.

## Canonical idioms (match these class strings)

- **Card surface:** `rounded-xl border bg-card shadow-sm` (premium variant adds
  `bg-gradient-to-b from-card/80 to-card/40 dark:from-card/60 dark:to-card/30
  backdrop-blur-xl`). See `components/charts/chart-card-styles.ts`.
- **Icons:** `lucide-react`, `size-4` standard / `size-3.5` compact / `strokeWidth={1.5}`.
- **Dense text:** `text-[13px]` controls, `text-sm` body, `text-xs
  text-muted-foreground` meta, `text-xl font-semibold tracking-tight` page/hero titles.
- **Spacing:** `gap-1.5` compact, `gap-2` standard, `gap-4` generous; card content `p-4 pt-0`.
- **Pill/secondary button link:** `inline-flex h-8 items-center gap-1.5 rounded-md
  border border-border px-3 text-[13px] font-medium hover:bg-muted`.
- **Clickable card → detail dialog:** whole card is the target (`role="button"` +
  `tabIndex={0}` + `onKeyDown={activateOnEnterOrSpace(open)}`, never a nested
  `<button>`); inner links `e.stopPropagation()` (not `preventDefault`) so they
  still navigate. Drive drill-down from a per-item field, rendered via
  `ResultTable`. See `components/health/{health-card-shell,health-detail-rows}.tsx`.
- **Overflow strip (one row, no wrap):** `scrollbar-hide overflow-x-auto` + `py-*`
  (so shadows/accents/focus rings aren't clipped) with a chevron button + a
  `from-background`→`transparent` edge fade per scrollable side, paging via
  `scrollBy`. Re-measure on scroll / `ResizeObserver` / content-count change.
  Copy `components/insights/insights-strip.tsx`.
- **Paired page sections** (e.g. AI-generated vs. plain-statistics content):
  identical-weight header on both — `icon (size-4, muted-foreground) + <h2
  className="text-sm font-medium text-foreground">`. An empty section still
  gets the header, with an `EmptyState variant="no-data" compact` placeholder
  card below it rather than being omitted. See `/insights` and
  `/insights-settings` (`AI Insights` vs `Statistics Insights`).

## Charts — always wrap state, never hand-roll it

Use `ChartContainer` (renders skeleton / `ChartError` / empty) + `ChartCard`
(title, SQL, metadata, stale indicator, retry). Fetch with `useChartData({
chartName, hostId, interval })`. Header icon order:
`[StaleIndicator] [DateRange] [LogScaleToggle] [CardToolbar]`. Copy an existing
chart in `components/charts/` as the template — don't reinvent the wiring.

## Loading / empty / error

- **Loading:** a `Skeleton` that matches the final layout (`components/skeletons/`)
  to avoid layout shift; gate with `Suspense` where used.
- **Empty:** `EmptyState` (`components/ui/empty-state.tsx`) with the right
  `variant` (`no-data | no-results | error | table-missing | timeout |
  filtered-empty | offline | loading`), `icon`, `title`, `description`, optional
  `action`/`onRefresh`.
- **Error (graceful):** initial error (`error && !hasData`) → full `ChartError`
  with retry. Revalidation error (`staleError`) → KEEP showing data + subtle
  amber `ChartStaleIndicator` (hover-revealed), auto-clears on next success.
  Never blank out good data on a refresh failure.
- **First run (zero hosts):** `FirstRunGate` → `FirstRunEmptyState` (3 modes:
  cloud signed-in / cloud anon / self-hosted). See the `cloud-saas-mode` skill.

## Data tables

Use the `components/data-table/` system (resizing, wrap toggle, sorting via
`sorting-fns.ts`, pagination, faceted filters, row actions, SQL display).
Synthetic column ids `__expand`, `select`, `action` are non-data — skip them in
filter/search/sort/card wiring.

## Adding a page

1. `src/routes/(dashboard)/my-page.tsx` (`'use client'`, uses `useHostId()`).
2. Add a `QueryConfig` in `src/lib/query-config/` if it needs data.
3. Register in `src/menu.ts` (with feature gate / `tableCheck` if optional).
4. Compose `ChartContainer` + `ChartCard`; reuse skeletons + empty/error states.

## File & naming conventions

kebab-case files; PascalCase components; `use*` camelCase hooks; props as
`interface XProps` colocated; client components declare `'use client'`, server
components don't; shared types in `src/types/` or `src/lib/api/types.ts`. Details
in `docs/knowledge/conventions.md`.

## Keep this skill current

This skill is the source of truth for design consistency. When you introduce or
change a durable UI pattern (a new token, a reusable component, an
empty/error/onboarding convention), UPDATE this file + `docs/knowledge/
product-design.md` in the SAME change. See the "Auto-improve project skills"
note in the root `CLAUDE.md`.
