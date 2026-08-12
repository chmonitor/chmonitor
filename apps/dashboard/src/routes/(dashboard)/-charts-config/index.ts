/**
 * Chart configuration for the Overview page.
 *
 * This module centralizes all chart configurations for the overview page,
 * providing a clean, maintainable structure for chart definitions.
 *
 * Tab Structure:
 * - Overview: At-a-glance health metrics (query, memory, CPU, disk, replication)
 * - Queries: Query performance and patterns
 * - Storage: Disk usage, tables, parts, backups
 * - Operations: Merge operations and replication health
 * - Health: Errors, connections, and coordination
 *
 * Split into per-tab modules (#2942) so each tab's chart config is
 * independently readable/editable. Re-exports everything so existing
 * importers of './-charts-config' keep working unchanged.
 */

export * from './health'
export * from './memory-cpu'
export * from './operations'
export { OVERVIEW_TAB_CHARTS } from './overview'
export * from './queries'
export * from './storage'
export * from './types'

import { HEALTH_TAB_CHARTS } from './health'
import { MEMORY_CPU_TAB_CHARTS } from './memory-cpu'
import { OPERATIONS_TAB_CHARTS } from './operations'
import { OVERVIEW_TAB_CHARTS } from './overview'
import { QUERIES_TAB_CHARTS } from './queries'
import { STORAGE_TAB_CHARTS } from './storage'
import type { OverviewTabConfig } from './types'

// ============================================================================
// Tab Configurations
// ============================================================================

const GRID_LAYOUT_3_COL =
  'grid grid-flow-dense auto-rows-[280px] items-stretch gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:auto-rows-[300px] 2xl:auto-rows-[320px] min-w-0'
const GRID_LAYOUT_2_COL =
  'grid grid-flow-dense auto-rows-[280px] grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:auto-rows-[300px] 2xl:auto-rows-[320px] min-w-0'
// Storage tab uses a tighter 16px gap and a smaller base row height so
// disk-size's row-span-2 lands at a comfortable height without over-stretching
// the chart-only cards beside it.
const GRID_LAYOUT_STORAGE =
  'grid grid-flow-dense auto-rows-[240px] items-stretch gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:auto-rows-[260px] 2xl:auto-rows-[280px] min-w-0'

/**
 * All tab configurations for the overview page
 */
export const OVERVIEW_TABS: OverviewTabConfig[] = [
  {
    value: 'overview',
    label: 'Overview',
    gridClassName: GRID_LAYOUT_3_COL,
    charts: OVERVIEW_TAB_CHARTS,
  },
  {
    value: 'topology',
    label: 'Cluster Topology',
    gridClassName: '',
    charts: [],
    customContent: 'topology',
  },
  {
    value: 'queries',
    label: 'Queries',
    gridClassName: GRID_LAYOUT_3_COL,
    charts: QUERIES_TAB_CHARTS,
  },
  {
    value: 'memory-cpu',
    label: 'Memory & CPU',
    gridClassName: GRID_LAYOUT_2_COL,
    charts: MEMORY_CPU_TAB_CHARTS,
  },
  {
    value: 'storage',
    label: 'Storage',
    gridClassName: GRID_LAYOUT_STORAGE,
    charts: STORAGE_TAB_CHARTS,
  },
  {
    value: 'operations',
    label: 'Operations',
    gridClassName: GRID_LAYOUT_2_COL,
    charts: OPERATIONS_TAB_CHARTS,
  },
  {
    value: 'health',
    label: 'Health',
    gridClassName: GRID_LAYOUT_3_COL,
    charts: HEALTH_TAB_CHARTS,
  },
]
