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
  const { isCollapsed, toggleCollapsed, isRowCollapsed, toggleRow } =
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
      {hasCharts && (
        <div className="flex flex-col gap-2">
          <ChartsToggle isCollapsed={isCollapsed} onToggle={toggleCollapsed} />
          {/* Always mounted — collapsing shows a lightweight per-row summary
              (ChartRowSummary/ChartChip, its own slow-polling fetch) instead
              of the full chart grid, rather than unmounting it entirely. */}
          <FadeIn duration={200}>
            <RelatedCharts
              relatedCharts={relatedCharts}
              gridClass={chartsGridClass}
              isRowCollapsed={isRowCollapsed}
              onToggleRow={toggleRow}
            />
          </FadeIn>
        </div>
      )}

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

      {footerContent}
    </div>
  )
}

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

export function createQueryPage(options: CreateQueryPageOptions) {
  return function Page() {
    return <QueryPageLayout {...options} />
  }
}
