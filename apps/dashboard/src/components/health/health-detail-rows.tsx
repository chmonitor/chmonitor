import { RefreshCw } from 'lucide-react'

import { ResultTable } from '@/components/sql-console/result-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useChartData } from '@/lib/query/use-chart-data'

interface HealthDetailRowsProps {
  chartName: string
  hostId: number
  title: string
  description?: string
  emptyMessage?: string
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const

/**
 * Drill-down rows behind a check's headline number, rendered via `ResultTable`.
 *
 * Rendered only while the detail dialog is open (Radix unmounts `DialogContent`
 * when closed), so /health does not fetch every breakdown up-front.
 */
export function HealthDetailRows({
  chartName,
  hostId,
  title,
  description,
  emptyMessage,
}: HealthDetailRowsProps) {
  const { data, isLoading, error, hasData, metadata, mutate } = useChartData({
    chartName,
    hostId,
    // One-shot fetch on open — the dialog is not a live-refreshing surface.
    refreshInterval: 0,
  })

  // An *optional* backing table that is absent returns 200 + a benign
  // `metadata.unavailable` note (see /api/v1/charts/$name), not an error.
  const unavailable = (
    metadata as
      | { unavailable?: { message?: string; reason?: string } }
      | undefined
  )?.unavailable

  const rowCount = data.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {hasData && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] max-sm:text-xs font-medium tabular-nums text-muted-foreground">
            {rowCount}
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {unavailable ? (
        <EmptyState
          variant="table-missing"
          compact
          title="Not available on this server"
          description={
            unavailable.message ??
            (unavailable.reason === 'column_not_found'
              ? 'This ClickHouse build does not expose the metric this check needs.'
              : 'The system table backing this check is not present.')
          }
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {SKELETON_KEYS.map((k) => (
            <Skeleton key={k} className="h-8 w-full" />
          ))}
        </div>
      ) : error && !hasData ? (
        <EmptyState
          variant="error"
          compact
          description={error.message}
          action={{
            label: 'Retry',
            onClick: () => void mutate(),
            icon: <RefreshCw className="size-4" />,
          }}
        />
      ) : !hasData ? (
        <EmptyState
          variant="no-data"
          compact
          title="No rows"
          description={emptyMessage ?? 'This check has no affected rows.'}
        />
      ) : (
        <ResultTable rows={data} emptyMessage={emptyMessage} />
      )}
    </div>
  )
}
