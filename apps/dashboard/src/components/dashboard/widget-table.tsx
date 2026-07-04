/**
 * widget-table — renders a data table for a `queryConfigName`, resolved via
 * the same `getQueryConfigByName` lookup the rest of the app uses (no
 * parallel registry). Reuses `TableClient` (the same component `PageLayout`
 * renders for a full page) scaled down into the widget frame — a compact
 * page size and no schema-driven filter bar, since the widget has limited
 * screen real estate.
 */

import type { DashboardWidget } from '@/types/dashboard-layout'

import { Suspense } from 'react'
import { TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { EmptyState } from '@/components/ui/empty-state'
import { getQueryConfigByName } from '@/lib/query-config'

export function WidgetTable({ widget }: { widget: DashboardWidget }) {
  const config = widget.queryConfigName
    ? getQueryConfigByName(widget.queryConfigName)
    : undefined

  if (!config) {
    return (
      <EmptyState
        variant="no-data"
        compact
        title="Table not found"
        description={
          widget.queryConfigName
            ? `"${widget.queryConfigName}" is not a registered query.`
            : 'This widget has no table selected.'
        }
      />
    )
  }

  return (
    <Suspense fallback={<TableSkeleton />}>
      <TableClient
        title={widget.title || config.name}
        description={config.description}
        queryConfig={config}
        className="flex h-full min-h-0 flex-col"
        defaultPageSize={5}
        showFilterBar={false}
      />
    </Suspense>
  )
}
