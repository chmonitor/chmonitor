/**
 * QueryPageLayout Component
 *
 * Generic page layout for query-based data pages.
 *
 * Provides:
 * - Optional header/footer content slots
 * - Collapsible related charts grid with localStorage persistence
 * - Data table integration
 * - Responsive chart grid (1→2→3→4 columns based on count)
 *
 * Usage:
 * ```tsx
 * import { QueryPageLayout } from '@/components/layout/query-page'
 * import { myQueryConfig } from '@/lib/query-config'
 *
 * export default function MyPage() {
 *   return <QueryPageLayout queryConfig={myQueryConfig} title="My Data" />
 * }
 * ```
 */

import type { QueryConfig } from '@/types/query-config'

import { ChartsToggle } from './charts-toggle'
import { RelatedCharts } from './related-charts'
import { useChartsCollapsed } from './use-charts-collapsed'
import { type ReactNode, Suspense } from 'react'
import { FeatureUnavailable } from '@/components/feature-permissions/feature-unavailable'
import { TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { FadeIn } from '@/components/ui/fade-in'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'

export interface QueryPageLayoutProps {
  /** Query config for the page table */
  queryConfig: QueryConfig
  /** Title for the table (defaults to queryConfig.name) */
  title?: string
  /** Description for the table (defaults to queryConfig.description) */
  description?: string
  /** Additional content to render after table */
  footerContent?: ReactNode
  /** Custom grid class for charts */
  chartsGridClass?: string
  /** Whether to hide the table */
  hideTable?: boolean
  /** Custom renderer used in place of the default data table (e.g. a card list) */
  tableSlot?: ReactNode
  /** Additional search params to pass to table */
  searchParams?: Record<string, string | number | boolean>
  /** Enable row selection with checkboxes */
  enableRowSelection?: boolean
  /** Default page size for the table */
  defaultPageSize?: number
  /** Maximum height for the table card */
  maxTableHeight?: string
  /**
   * When set, clicking a table row (outside interactive elements) calls this
   * with the row's data instead of the default behavior — e.g. to open a
   * detail Sheet. Desktop table rows only; ignored when `tableSlot` is used.
   */
  onRowClick?: (row: Record<string, unknown>) => void
}

export const QueryPageLayout = function QueryPageLayout({
  queryConfig,
  title,
  description,
  footerContent,
  chartsGridClass,
  hideTable = false,
  tableSlot,
  searchParams,
  enableRowSelection = false,
  defaultPageSize,
  maxTableHeight,
  onRowClick,
}: QueryPageLayoutProps) {
  const { config, isLoading } = useFeaturePermissions()
  const relatedCharts = queryConfig.relatedCharts || []
  const { isCollapsed, toggleCollapsed, collapsedRows, toggleRow } =
    useChartsCollapsed()
  const hasCharts = relatedCharts.length > 0
  const featureState = resolveFeatureState(queryConfig.permission, config)

  // Only the `enabled` deployment toggle gates rendering here. Access (public vs
  // authenticated) is enforced by the backend, not the client — see
  // lib/feature-permissions/server.ts (the single security boundary).
  if (queryConfig.permission && !isLoading && !featureState.enabled) {
    return (
      <FeatureUnavailable
        feature={queryConfig.permission.feature}
        reason="disabled"
      />
    )
  }

  return (
    <div className="flex min-w-0 w-full max-w-full flex-1 flex-col gap-3 sm:gap-4">
      {/* Charts Section with Collapse Toggle */}
      {hasCharts && (
        <div className="flex flex-col gap-2">
          <ChartsToggle isCollapsed={isCollapsed} onToggle={toggleCollapsed} />
          {!isCollapsed && (
            <FadeIn duration={200}>
              <RelatedCharts
                relatedCharts={relatedCharts}
                gridClass={chartsGridClass}
                collapsedRows={collapsedRows}
                onToggleRow={toggleRow}
              />
            </FadeIn>
          )}
        </div>
      )}

      {/* Data Table — the schema-driven filter bar renders inline in its header */}
      {!hideTable && (
        <Suspense fallback={<TableSkeleton />}>
          <FadeIn
            duration={300}
            className="flex min-w-0 flex-1 flex-col"
            style={maxTableHeight ? { maxHeight: maxTableHeight } : undefined}
          >
            {tableSlot ?? (
              <TableClient
                title={title || queryConfig.name}
                description={description || queryConfig.description}
                queryConfig={queryConfig}
                searchParams={searchParams}
                className="flex min-w-0 flex-1 flex-col"
                enableRowSelection={enableRowSelection}
                defaultPageSize={defaultPageSize}
                onRowClick={onRowClick}
              />
            )}
          </FadeIn>
        </Suspense>
      )}

      {/* Optional Footer Content */}
      {footerContent}
    </div>
  )
}

/**
 * Options for creating a standardized page from a QueryConfig
 */
export interface CreateQueryPageOptions {
  queryConfig: QueryConfig
  title?: string
  description?: string
  footerContent?: ReactNode
  chartsGridClass?: string
  hideTable?: boolean
  tableSlot?: ReactNode
  searchParams?: Record<string, string | number | boolean>
  enableRowSelection?: boolean
  defaultPageSize?: number
  maxTableHeight?: string
}

/**
 * HOC for creating a page from a QueryConfig.
 *
 * Usage:
 * ```tsx
 * import { createQueryPage } from '@/components/layout/query-page'
 * import { myQueryConfig } from '@/lib/query-config'
 *
 * export default createQueryPage({
 *   queryConfig: myQueryConfig,
 *   title: 'My Data',
 * })
 * ```
 */
export function createQueryPage(options: CreateQueryPageOptions) {
  return function Page() {
    return <QueryPageLayout {...options} />
  }
}
