import { RefreshCw } from 'lucide-react'

import { ResultTable } from '@/components/sql-console/result-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useChartData } from '@/lib/query/use-chart-data'

interface HealthDetailRowsProps {
  /** Registry chart name whose query returns the affected rows. */
  chartName: string
  hostId: number
  /** Section heading, e.g. "Affected rows" or "Likely cause: …". */
  title: string
  /** Optional caption clarifying what the rows represent. */
  description?: string
  /** Message shown when the query returns no rows. */
  emptyMessage?: string
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const

/**
 * The drill-down breakdown for a health check: the actual rows behind the
 * headline number (lagging replicas, failing queries, offending partitions, …).
 *
 * Rendered only while the detail dialog is open — Radix unmounts `DialogContent`
 * when closed, so this component (and its `useChartData` fetch) mounts on open
 * and unmounts on close. That keeps the /health page from fetching 17 breakdown
 * queries up-front; each is fetched lazily the first time a card is opened.
 *
 * Generic by design: it renders whatever columns the check's detail query
 * returns via the shared `ResultTable`, so a new check needs only a
 * `detailChartName` — no per-card rendering code here.
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
    metadata as { unavailable?: { message?: string } } | undefined
  )?.unavailable

  const rowCount = data.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {hasData && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
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
            'The system table backing this check is not present.'
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
