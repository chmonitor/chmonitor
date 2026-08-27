import type { MenuItem } from '@/components/menu/types'

import { detectQuickNav } from '../command-palette-utils'

// Cap how many databases/tables are rendered — cmdk fuzzy-filters the
// remaining rows as the user types, but that's about UX (not fetch cost);
// the API call itself is already limited server-side.
export const EXPLORER_RESULTS_LIMIT = 200
export const EXPLORER_GROUP_MAX = 8

export interface ExplorerTableRow {
  database: string
  name: string
  engine: string
}

interface MergedHostLike {
  id: number
  name?: string | null
  host: string
}

export interface PaletteGroups {
  favoriteMenuItems: readonly MenuItem[]
  leafItems: MenuItem[]
  sectionedItems: MenuItem[]
  databases: string[]
  tables: ExplorerTableRow[]
  otherHosts: MergedHostLike[]
  quickNav: ReturnType<typeof detectQuickNav>
}

/**
 * Pure derivation of the command palette's groups from menu items,
 * favorites, the explorer table listing, and the merged host list. The
 * palette UI filters and ranks rows in `filterPaletteRows` (cmdk
 * `shouldFilter` is off), so this does NOT filter by `query`; it only
 * computes the quick-navigation affordance (`isQueryId` / `isTableName`),
 * which genuinely depends on the current input.
 */
export function derivePaletteGroups({
  menuItems,
  favoriteMenuItems,
  tableRows,
  hosts,
  currentHostId,
  query,
}: {
  menuItems: readonly MenuItem[]
  favoriteMenuItems: readonly MenuItem[]
  tableRows: readonly ExplorerTableRow[] | undefined
  hosts: readonly MergedHostLike[]
  currentHostId: number
  query: string
}): PaletteGroups {
  // Top-level entries without sub-items (Overview, AI Agent, Insights, Health…)
  // are collapsed into a single "Go to" group so each one no longer renders its
  // own redundant single-item heading. Entries that have sub-items keep their
  // own group.
  const leafItems = menuItems.filter(
    (group) => !group.items || group.items.length === 0
  )
  const sectionedItems = menuItems.filter(
    (group) => group.items && group.items.length > 0
  )

  const seenDatabases = new Set<string>()
  for (const row of tableRows ?? []) seenDatabases.add(row.database)
  // Full lists — the All tab slices to EXPLORER_GROUP_MAX; dedicated
  // Databases / Tables tabs show everything fetched.
  const databases = [...seenDatabases]
  const tables = [...(tableRows ?? [])]

  const otherHosts = hosts.filter((h) => h.id !== currentHostId)

  const quickNav = detectQuickNav(query)

  return {
    favoriteMenuItems,
    leafItems,
    sectionedItems,
    databases,
    tables,
    otherHosts,
    quickNav,
  }
}

/**
 * React-facing entry point. Currently a thin pass-through to
 * {@link derivePaletteGroups} — kept as its own hook so future memoization
 * can be added without touching `CommandPalette` or the pure logic's tests.
 */
export function usePaletteGroups(
  args: Parameters<typeof derivePaletteGroups>[0]
): PaletteGroups {
  return derivePaletteGroups(args)
}
