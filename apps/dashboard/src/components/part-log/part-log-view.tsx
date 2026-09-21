import {
  Download,
  Filter,
  LayoutDashboardIcon,
  MinimizeIcon,
  RefreshCw,
} from 'lucide-react'

import type { CardError } from '@/lib/card-error-utils'
import type { PartLogRow } from './lib'

import { useState } from 'react'
import { PageHeader } from '@/components/layout'
import { CollapsedChartsRow } from '@/components/layout/query-page/collapsed-charts-row'
import { PartLogCharts } from '@/components/part-log/part-log-charts'
import { PartLogTable } from '@/components/part-log/part-log-table'
import { Skeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
  getCardErrorTitle,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import { arrayToCsv, downloadCsv } from '@/lib/csv'
import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

/** Auto-refresh cadence for the part_log table (ms). */
const REFRESH_INTERVAL = 30_000

function HeaderButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-[12px]"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[230px] rounded-xl" />
      <Skeleton className="h-[360px] rounded-xl" />
    </div>
  )
}

/**
 * PartLogView — the redesigned Part Log page.
 *
 * Reads `system.part_log` (via the `part-log` table config) and renders a
 * header, a collapsible chart strip ({@link PartLogCharts} — KPIs, lifecycle
 * stacked bars, merge-reason donut, per-table churn and a size histogram), and
 * the sortable {@link PartLogTable} with quick filters and expandable detail
 * panels. Every number is derived from real rows; the 24h lifecycle chart is
 * the only server-aggregated series (`part-log-lifecycle`).
 */
export function PartLogView() {
  const hostId = useHostId()
  const [chartsOpen, setChartsOpen] = useState(true)

  const { data, error, isLoading, isValidating, refresh } =
    useTableData<PartLogRow>('part-log', hostId, undefined, REFRESH_INTERVAL)

  const rows = data ?? []

  const exportCsv = () => {
    const csv = arrayToCsv(rows as unknown as Record<string, unknown>[])
    if (csv) downloadCsv(csv, `part-log-host-${hostId}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            Part Log
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-foreground">
              {rows.length.toLocaleString()} events
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <span className="relative inline-flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              live
            </span>
          </div>
        }
        description={
          <>
            Part lifecycle from{' '}
            <span className="font-mono">system.part_log</span>: creation,
            merges, mutations, downloads, moves and removals · most recent 1,000
            events · auto-refreshes every {Math.round(REFRESH_INTERVAL / 1000)}s
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <HeaderButton onClick={() => setChartsOpen((v) => !v)}>
              {chartsOpen ? (
                <MinimizeIcon className="size-3.5" />
              ) : (
                <LayoutDashboardIcon className="size-3.5" />
              )}
              {chartsOpen ? 'Collapse charts' : 'Expand charts'}
            </HeaderButton>
            <HeaderButton onClick={() => refresh()} disabled={isValidating}>
              <RefreshCw
                className={cn('size-3.5', isValidating && 'animate-spin')}
              />
              Refresh
            </HeaderButton>
            <HeaderButton onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="size-3.5" />
              Export CSV
            </HeaderButton>
            <Button size="sm" className="h-8 gap-1.5 text-[12px]">
              <Filter className="size-3.5" />
              Filters
            </Button>
          </div>
        }
      />

      {isLoading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <Card className="rounded-xl">
          <CardContent className="p-4">
            <EmptyState
              variant={toEmptyStateVariant(
                detectCardErrorVariant(error as CardError)
              )}
              title={getCardErrorTitle(
                detectCardErrorVariant(error as CardError),
                'Part Log'
              )}
              description={getCardErrorDescription(
                error as CardError,
                detectCardErrorVariant(error as CardError)
              )}
              compact
              action={{
                label: 'Retry',
                onClick: refresh,
                icon: <RefreshCw className="mr-1.5 size-3.5" />,
              }}
            />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-xl border-dashed">
          <CardContent className="p-6">
            <EmptyState
              variant="no-data"
              title="No part events yet"
              description="Nothing has been logged to system.part_log on this host recently. Part lifecycle events appear here automatically."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {chartsOpen ? (
            <PartLogCharts rows={rows} />
          ) : (
            <CollapsedChartsRow
              labels={['Total events', 'New parts', 'Merges', 'Part lifecycle']}
              onExpand={() => setChartsOpen(true)}
            />
          )}
          <PartLogTable rows={rows} hostId={hostId} />
        </>
      )}
    </div>
  )
}
