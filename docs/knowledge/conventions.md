---
id: conventions
title: Development Conventions
type: workflow
status: active
updated: 2026-09-03
tags:
  - conventions
  - patterns
  - development
related:
  - static-site-architecture
  - component-ci-stability
---

# Development Conventions

## Component Patterns

- **Static-First Rendering** — pages are prerendered at build time (static shell) with client-side data fetching via TanStack Query
- **Hooks at deepest consumer** — use hooks at the component that needs data, not parent. Example: `CountBadge` calls `useHostId()` internally rather than receiving `hostId` as a prop
- **Compound components** for complex UI (data tables)

## File Organization

- Root route: `src/routes/__root.tsx`
- Dashboard pages: File-based routes under `src/routes/(dashboard)/`
- API routes: Server-side API endpoints under `src/routes/api/`
- Navigation config: Per-section files under `src/menu/` composed by
  `src/menu/index.ts` (re-exported from `src/menu.ts`). Interactive utilities
  live in `menu/tools.ts`; system-table views stay in their domain file
  (TTL & Partitions is under Tables). ⌘K matches sidebar title, document
  `<title>` (`lib/page-title.ts`), href, description, and optional
  `MenuItem.keywords`.
  Leave `engines` absent on Tools so Postgres hosts hide the whole group
  (`filterMenuItemsByEngine`); do not add `engines: ['postgres']`.
- Styles: Main Tailwind v4 stylesheet at `src/styles.css`
- Test files co-located with components or in cypress/ directory (`.cy.tsx` / `.cy.ts`)

## shadcn/ui Rules

**Never customize `components/ui/` files directly.**

- Allow easy updates via `npx shadcn@latest add <component>`
- Pass custom classes via `className` prop at usage site
- Create wrapper components in `components/` (not `components/ui/`) if needed
- Use `cn()` utility to merge classes

## Radix Overlays (DropdownMenu / Popover)

**Use `modal={false}` for toolbar/filter dropdowns and popovers.**

Radix `DropdownMenu` defaults to `modal={true}`. A modal overlay runs
`hideOthers()`, which stamps `aria-hidden`/`data-aria-hidden` onto **every
top-level sibling** of the menu portal (sidebar, header, the whole table) on
open and strips them on close. On a populated page, toggling this attribute on
the root containers wrapping the entire UI forces a full-page accessibility/style
recompute — perceived as a "full-page re-render" each time the menu opens (e.g.
the Presets menu, fixed in PR #1360).

- `DropdownMenu` defaults to `modal={true}` → set `modal={false}` for toolbar menus.
- `Popover` already defaults to `modal={false}` → safe as-is.
- Reserve modal overlays for genuine modal flows (confirm dialogs), not toolbars.

## className Composition

**Always use `cn()` for className — never string concatenation or template literals.**

- Bad: `` className={`flex ${isActive ? 'text-red' : 'text-gray'}`} ``
- Bad: `className={'flex ' + (isActive ? 'text-red' : 'text-gray')}`
- Good: `className={cn('flex', isActive ? 'text-red' : 'text-gray')}`
- Good: `className={cn('flex', isActive && 'text-red')}`

Reason: `cn()` (the `cn` package) deduplicates conflicting Tailwind classes (e.g. `p-2 p-4` → `p-4`) and handles falsy values cleanly. Template literals leave conflicting classes in place, causing unpredictable specificity bugs.

## Query Patterns

- All queries include `QUERY_COMMENT` for identification (applied centrally in `fetchData()`)
- Use `fetchData` function for consistent error handling and logging
- **CRITICAL**: `fetchData` requires `hostId` parameter (not optional)
- Client components use SWR hooks for data fetching

## Chart Patterns

- Use SWR `useChartData` hook with `hostId` prop
- Handle loading, error, and empty states
- Graceful error handling: initial errors show `ChartError`, revalidation errors keep showing data with amber indicator
- Progress bars preferred over donut charts for percentage displays

## Error Handling

- `useChartData` returns `staleError` and `hasData`
- `ChartContainer` shows `ChartError` only when `error && !hasData`
- `ChartCard` renders `ChartStaleIndicator` when `staleError` exists
- Icon order in header: `[Stale Indicator] [DateRangeSelector] [CardToolbar]`
