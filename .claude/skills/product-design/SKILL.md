---
name: product-design
description: >-
  chmonitor's design system and UX conventions. Use before building or
  reviewing any dashboard UI: a page, chart, card, dialog, table, badge,
  loading/empty/error state, settings or alert surface, sidebar or menu entry,
  hub page, command palette, What's new, Schema Compare, or Advisor. Covers
  tokens, shadcn/Base UI rules, chart and state wrappers, sidebar groups, and
  responsive and touch rules.
---

# chmonitor product design

Copy the closest existing component before inventing one. The rules below
apply to every UI change. Per-surface detail (sidebar, settings, alerts,
⌘K, Schema Compare, Advisor, What's new, agent chat) lives in
[docs/knowledge/product-design.md](../../../docs/knowledge/product-design.md);
grep it for the surface you are touching before you edit.

Paths below are under `apps/dashboard/src/`.

## Rules

1. **Never edit `components/ui/*`.** Style at the call site with `className`
   merged by `cn()` (`lib/utils.ts`), or wrap in `components/`. The
   primitives are Base UI: use `render`, not `asChild`, and `data-open` /
   `data-active`, not `data-[state=…]`.
2. **Semantic tokens only.** Tailwind v4 tokens live in `styles.css`
   (`@theme`, OKLCH). Use `bg-card`, `text-muted-foreground`, `border-border`,
   never hex, `oklch()`, `hsl(var(--…))`, `bg-white`, or `text-black`. Every
   surface must read in light and dark (`.dark` class).
3. **Chart colours:** `--chart-1..13` for series; `--chart-red`, `-blue`,
   `-green`, `-yellow` for error, info, success, warning. A token missing from
   `styles.css` renders the series black.
4. **Hooks at the deepest consumer.** The component that shows the data calls
   `useHostId()` / `useChartData()`. No `hostId` prop drilling.
5. **`?host=N` routing**, never `/N/...`. Keep other params with
   `buildUrl(pathname, { host }, searchParams)`. Data under a host name must
   come from that host (`keepPreviousDataForHost`, `key={hostId}`; see
   [static-site-architecture.md](../../../docs/knowledge/static-site-architecture.md)
   "Host-scoped cache").
6. **One signal per state.** No accent rail on a coloured border, no glow
   blobs, no icon tile plus coloured border plus pill for one severity
   (`components/insights/severity-meta.ts` owns severity). See "Anti-patterns"
   in the doc.
7. **Touch is not hover.** Never hand-write `opacity-0 group-hover:` on an
   action. Use `chartActionClass()` (`components/cards/chart-action-classes.ts`)
   or `pointer-coarse:` sizing. Phone hit targets are 44px; below `lg` the
   sidebar is an overlay and row actions live in the "…" menu.
8. **Recommend, never apply.** Advisor, Schema Compare, and TTL pages show
   copyable DDL (`components/ddl/recommend-ddl-blocks.tsx`). No Run or Apply
   button.

## States

- **Charts:** `ChartContainer` (skeleton, `ChartError`, empty) inside
  `ChartCard` (title, SQL, stale indicator, retry). Header order:
  `[ChartStaleIndicator] [ScaleToggle] [DateRangeSelector] [CardToolbar]`. Copy a chart
  in `components/charts/`.
- **Loading:** a `Skeleton` shaped like the final layout
  (`components/skeletons/`).
- **Empty:** `EmptyState` (`components/ui/empty-state.tsx`) with the matching
  `variant`. Table query failures use the full, non-compact form so the cause
  shows. User-input problems get an `EmptyState` with next steps, not
  `ErrorAlert`.
- **Errors:** an initial failure with no data shows `ChartError`. A failed
  refresh keeps the data and shows the amber stale indicator. Never blank good
  data.
- **First run (zero hosts):** `FirstRunGate`; see the `cloud-saas-mode` skill.

## Common idioms

- Card: `rounded-xl border bg-card shadow-sm`
  (`components/charts/chart-card-styles.ts`).
- Icons: `lucide-react`, `size-4` (compact `size-3.5`), `strokeWidth={1.5}`.
- Text: `text-sm` body, `text-[13px]` controls, `text-xs text-muted-foreground`
  meta, `text-xl font-semibold tracking-tight` titles.
- Clickable card: the whole card is the target (`role="button"`,
  `activateOnEnterOrSpace` from `lib/a11y.ts`), inner links
  `stopPropagation()`.
- A dialog opened from a popover renders as a sibling of `<Popover>`, not
  inside it.
- Dialog with fixed header and footer: `DialogContent` is
  `flex flex-col overflow-hidden p-0` with a max height; the body is
  `min-h-0 flex-1 overflow-y-auto`. Not `ScrollArea`, and no `relative` on
  `DialogContent`.
- Illustrations: inline React SVG in `components/illustrations/`, coloured by
  `currentColor` and tokens, animated only under `motion-safe:`.
- Brand accents: orange for metrics, emerald for health and live state.

## Adding a page

1. `routes/(dashboard)/<name>.tsx` exports `Route` via
   `createFileRoute('/(dashboard)/<name>')`.
2. Data comes from a `QueryConfig` in `lib/query-config/` (see the
   `clickhouse-query-config` skill).
3. Register it in the task group's `menu/<section>.ts` with a `subgroup`.
   Never nest `items` in `items` or add a top-level group. A `tableCheck` page
   hides when its table is missing; a `requiresMetadataDb` page dims. Read
   "Sidebar navigation groups" in the doc first; `hub.test.ts` and
   `workspace-presets.test.ts` enforce the rest.
4. Add a `ROUTE_TITLE_MAP` entry (`lib/page-title.ts`) when the title differs
   from the title-cased last URL segment.

Files are kebab-case, components PascalCase, hooks `use*`, props
`interface XProps`; see
[conventions.md](../../../docs/knowledge/conventions.md).

When you add or change a durable UI pattern, update the doc in the same
change, and this skill only if a rule above changes.
