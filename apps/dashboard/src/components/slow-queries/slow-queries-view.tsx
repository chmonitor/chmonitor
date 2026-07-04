import { ChevronDown, Gauge, RefreshCw, ScanSearch, Timer } from 'lucide-react'

import type { SlowQueryRow } from '@/components/slow-queries/slow-queries-table'
import type { CardError } from '@/lib/card-error-utils'

import { useMemo, useState } from 'react'
import { RegressionPanel } from '@/components/alerting/regression-panel'
import { BulkExplainDialog } from '@/components/explain/bulk-explain-dialog'
import { PageHeader } from '@/components/layout'
import { RelatedCharts } from '@/components/layout/query-page/related-charts'
import { QueryPageSkeleton } from '@/components/query-tables/query-page-skeleton'
import { SlowQueriesTable } from '@/components/slow-queries/slow-queries-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
  getCardErrorTitle,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import { useTimeRange } from '@/lib/context/time-range-context'
import { truncateSql } from '@/lib/explain-heuristics'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useTableData } from '@/lib/query/use-table-data'
import { slowQueriesConfig } from '@/lib/query-config/queries/slow-queries'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

/** Refresh the slow-queries list every 60s — `query_log` is append-only. */
const REFRESH_INTERVAL = 60_000

const PRESETS = slowQueriesConfig.filterParamPresets ?? []
const DEFAULTS = slowQueriesConfig.defaultParams ?? {}

/** Group presets by the param key they drive (time window, min duration). */
const PRESET_GROUPS: { key: string; icon: typeof Timer; label: string }[] = [
  { key: 'last_hours', icon: Timer, label: 'Time window' },
  { key: 'min_duration_s', icon: Gauge, label: 'Min duration' },
]

// LoadingState is replaced by QueryPageSkeleton from @/components/query-tables/query-page-skeleton

/** A single-select chip group bound to one filter param key. */
function FilterGroup({
  groupKey,
  icon: Icon,
  label,
  active,
  onSelect,
}: {
  groupKey: string
  icon: typeof Timer
  label: string
  active: string
  onSelect: (key: string, value: string) => void
}) {
  const options = PRESETS.filter((p) => p.key === groupKey)
  if (options.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((opt) => {
          const selected = active === String(opt.value)
          return (
            <button
              key={`${opt.key}-${opt.value}`}
              type="button"
              onClick={() => onSelect(opt.key, String(opt.value))}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors',
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {opt.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * SlowQueriesView — the Slow Queries page.
 *
 * Header (title, slowest-query badge, refresh) → preset filter bar (time
 * window + min duration) → the related occurrences chart → the bespoke
 * {@link SlowQueriesTable}. Filters are stored in the URL so they survive
 * reloads and shape the data fetched from `/api/v1/tables/slow-queries`.
 */
export function SlowQueriesView() {
  const hostId = useHostId()
  const { timeRange } = useTimeRange()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [chartsOpen, setChartsOpen] = useState(true)
  const [explainOpen, setExplainOpen] = useState(false)

  // Resolve the active value of each filter key:
  //   URL param → global time-range context (for last_hours) → config default.
  // This means the global picker seeds the initial window, but explicit URL
  // params (e.g. from a shared link or the filter chips) take priority.
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const fromUrl = searchParams.get(key)
      let resolved: string
      if (key === 'last_hours') {
        resolved = fromUrl ?? String(timeRange.lastHours)
      } else {
        resolved = fromUrl ?? (value as string)
      }
      if (resolved !== '') params[key] = resolved
    }
    return params
  }, [searchParams, timeRange.lastHours])

  const { data, error, isLoading, isValidating, refresh } =
    useTableData<SlowQueryRow>(
      'slow-queries',
      hostId,
      filterParams,
      REFRESH_INTERVAL
    )

  const rows = data ?? []

  const explainItems = rows.slice(0, 20).map((r) => ({
    sql: String(r.query ?? ''),
    title: truncateSql(String(r.query ?? ''), 60),
  }))

  // Slowest duration drives the header highlight.
  const slowest = useMemo(() => {
    let max = 0
    for (const row of rows) {
      const d = Number(
        row.query_duration ??
          (row.query_duration_ms != null
            ? Number(row.query_duration_ms) / 1000
            : 0)
      )
      if (d > max) max = d
    }
    return max
  }, [rows])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={
            <div className="flex items-center gap-2">
              Slow Queries
              {rows.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  slowest
                  <span className="font-semibold tabular-nums text-foreground">
                    {slowest.toFixed(1)}s
                  </span>
                </span>
              )}
            </div>
          }
          description="The slowest finished queries from the query log, worst first"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setExplainOpen(true)}
                disabled={rows.length === 0}
              >
                <ScanSearch className="size-3.5" />
                Explain top N
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setChartsOpen((v) => !v)}
              >
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform',
                    !chartsOpen && '-rotate-90'
                  )}
                />
                {chartsOpen ? 'Hide chart' : 'Show chart'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => refresh()}
                disabled={isValidating}
              >
                <RefreshCw
                  className={cn('size-3.5', isValidating && 'animate-spin')}
                />
                Refresh
              </Button>
            </div>
          }
        />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
          {PRESET_GROUPS.map((group) => (
            <FilterGroup
              key={group.key}
              groupKey={group.key}
              icon={group.icon}
              label={group.label}
              active={filterParams[group.key] ?? ''}
              onSelect={setFilter}
            />
          ))}
        </div>

        {/* Body */}
        {isLoading && !data ? (
          <QueryPageSkeleton />
        ) : error && !data ? (
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <EmptyState
                variant={toEmptyStateVariant(
                  detectCardErrorVariant(error as CardError)
                )}
                title={getCardErrorTitle(
                  detectCardErrorVariant(error as CardError),
                  'Slow Queries'
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
        ) : (
          <>
            {slowQueriesConfig.relatedCharts && (
              <div
                className={cn(
                  'grid transition-all duration-300 ease-in-out',
                  chartsOpen
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0'
                )}
              >
                <div className="overflow-hidden">
                  {chartsOpen && (
                    <RelatedCharts
                      relatedCharts={slowQueriesConfig.relatedCharts}
                    />
                  )}
                </div>
              </div>
            )}
            {rows.length === 0 ? (
              <Card className="rounded-xl border-dashed">
                <CardContent className="p-6">
                  <EmptyState
                    variant="no-data"
                    title="No slow queries"
                    description="No queries crossed the duration threshold in this window. Try widening the time range or lowering the minimum duration."
                  />
                </CardContent>
              </Card>
            ) : (
              <SlowQueriesTable rows={rows} />
            )}
            <RegressionPanel hostId={hostId} />
          </>
        )}
      </div>

      <BulkExplainDialog
        queries={explainItems}
        hostId={hostId}
        open={explainOpen}
        onOpenChange={setExplainOpen}
      />
    </TooltipProvider>
  )
}
