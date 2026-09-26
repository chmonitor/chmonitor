---
id: table-availability
title: Table Availability, Sidebar Muting & Permission/Version Errors
type: spec
status: active
updated: 2026-09-27
tags:
  - menu
  - error-handling
  - clickhouse-version
  - permissions
related:
  - query-config-format
  - conventions
  - static-site-architecture
---

# Table Availability, Sidebar Muting & Permission/Version Errors

How the dashboard reacts when a backing `system.*` table is missing, the user
lacks privileges, or the ClickHouse version is too old for a feature.

## Sidebar muting (table availability)

Menu items backed by a system table are greyed out when that table doesn't
exist on the current host.

- **API**: `GET /api/v1/table-availability?hostId=<n>` →
  `{ data: { available: Record<string, boolean> } }`. Route at
  `src/routes/api/v1/table-availability.ts` (fail-soft, `hostId` validated,
  per-table feature authorization).
- **Hooks** (`components/menu/hooks/use-table-availability.ts`):
  - `useTableAvailability(hostId)` — one batched SWR request shared by **all**
    sidebar items via a common key `['/api/v1/table-availability', hostId]`
    (deduped; slow refresh — availability rarely changes).
  - `useIsTableAvailable(tableCheck, hostId)` — selects one item's status.
- **Fail-open**: an item is treated as **available unless explicitly reported
  `false`**. A failed/missing availability fetch never hides a working page.
- Consumed by `nav-main/menu-item.tsx` + `collapsed-submenu.tsx` (greyed style
  + "System table not found on this host" tooltip). The menu item's
  `tableCheck` comes from its `QueryConfig` (see [[query-config-format]]).

## Error variants (`lib/card-error-utils.ts`)

`detectCardErrorVariant(error)` classifies an error into a `CardErrorVariant`:
`'error' | 'offline' | 'timeout' | 'table-missing' | 'permission'`.

- **`permission`** — matched on keywords incl. ClickHouse's
  `not_enough_privileges` / `not enough privileges`. `table-client.tsx` renders
  a GRANT suggestion (`extractTableFromPermissionError` pulls the
  `system.x`/`default.x` table out of the message to build
  `GRANT SELECT ON <table> ...`).
- **Version mismatch** — when a `QueryConfig.sql` is a `VersionedSql[]` whose
  oldest `since` is newer than the host's version, `table-client.tsx` shows a
  "requires ClickHouse ≥ X" notice instead of an error. Driven by
  `isVersionOlder(current, required)` / `parseSimpleVersion()` (tested in
  `lib/__tests__/card-error-utils.test.ts`).

## GOTCHA — `permission` is NOT an `EmptyStateVariant`

`CardErrorVariant` includes `'permission'`, but the shared `EmptyState`
component's `variant` prop (`EmptyStateVariant`) does **not**. Passing a raw
`detectCardErrorVariant(...)` straight into `<EmptyState variant={...}>` is a
**type error**.

Always map it through **`toEmptyStateVariant(variant)`** (in
`card-error-utils.ts`), which falls back `permission → 'error'` for the visual
while the permission-specific title/description still come from
`getCardErrorTitle` / `getCardErrorDescription`. Every error `EmptyState` call
site must use it: `running-queries`, `expensive-queries`, `part-log`,
`slow-queries`, and `charts/chart-error.tsx`. Adding a new view that renders an
error `EmptyState` from a `CardErrorVariant`? Wrap it with `toEmptyStateVariant`
or the build breaks.
