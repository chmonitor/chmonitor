import {
  Flame,
  Gauge,
  LayoutDashboardIcon,
  MinimizeIcon,
  RefreshCw,
  ScanSearch,
  Timer,
} from 'lucide-react'

import type { ChartProps } from '@/components/charts/chart-props'
import type { ExpensiveQueryRow } from '@/components/expensive-queries/expensive-queries-table'
import type { CardError } from '@/lib/card-error-utils'

import { useMemo, useState } from 'react'
import { ExpensiveQueriesTable } from '@/components/expensive-queries/expensive-queries-table'
import { LoadSummary } from '@/components/expensive-queries/load-summary'
import { BulkExplainDialog } from '@/components/explain/bulk-explain-dialog'
import { PageHeader } from '@/components/layout'
import { CollapsedChartsRow } from '@/components/layout/query-page/collapsed-charts-row'
import { RelatedCharts } from '@/components/layout/query-page/related-charts'
import { HeaderButton } from '@/components/query-tables/header-button'
import { QueryPageSkeleton } from '@/components/query-tables/query-page-skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
  getCardErrorTitle,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import {
  TIME_RANGE_PRESETS,
  useTimeRange,
} from '@/lib/context/time-range-context'
import { truncateSql } from '@/lib/explain-heuristics'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useTableData } from '@/lib/query/use-table-data'
import { expensiveQueriesConfig } from '@/lib/query-config/queries/expensive-queries'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

// LoadingState is replaced by QueryPageSkeleton from @/components/query-tables/query-page-skeleton
// HeaderButton is imported from @/components/query-tables/header-button

const PRESETS = expensiveQueriesConfig.filterParamPresets ?? []
const DEFAULTS = expensiveQueriesConfig.defaultParams ?? {}

/** Group presets by the param key they drive (time window, min duration). */
const PRESET_GROUPS: { key: string; icon: typeof Timer; label: string }[] = [
  { key: 'last_hours', icon: Timer, label: 'Time window' },
  { key: 'min_duration_s', icon: Gauge, label: 'Min duration' },
]

/** Format an hours count as a compact window label (1 → "1h", 168 → "7d"). */
function formatHoursLabel(hours: number): string {
  if (hours > 0 && hours % 24 === 0) return `${hours / 24}d`
  return `${hours}h`
}

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
 * ExpensiveQueriesView — the Most Expensive Queries page.
 *
 * A self-contained layout: header (title, fingerprint count, charts toggle,
 * refresh) → a collapsible related-charts strip → the sortable, responsive
 * {@link ExpensiveQueriesTable}. Data is the `expensive-queries` config —
 * normalized query fingerprints aggregated over the last 24h of
 * `system.query_log`, ordered most-expensive-first.
 */
export const ExpensiveQueriesView = function ExpensiveQueriesView() {
  const hostId = useHostId()
  const { timeRange } = useTimeRange()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [chartsOpen, setChartsOpen] = useState(true)
  const [explainOpen, setExplainOpen] = useState(false)

  // Resolve the active value of each filter key:
  //   URL param → global time-range context (for last_hours) → config default.
  // The global picker seeds the initial window, but explicit URL params (a
  // shared link or the filter chips below) take priority.
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const fromUrl = searchParams.get(key)
      const resolved =
        key === 'last_hours'
          ? (fromUrl ?? String(timeRange.lastHours))
          : (fromUrl ?? String(value))
      if (resolved !== '') params[key] = resolved
    }
    return params
  }, [searchParams, timeRange.lastHours])

  const { data, error, isLoading, isValidating, refresh } =
    useTableData<ExpensiveQueryRow>('expensive-queries', hostId, filterParams)

  const rows = data ?? []
  // The hook always returns an array (never null), so the old `!data` guard was
  // dead — the empty state flashed during the initial fetch. Gate the skeleton
  // on the query state + emptiness instead. Using `isLoading && rows.length===0`
  // (not `||`) keeps prior rows visible on chip/range changes via placeholderData.
  const showSkeleton = isLoading && rows.length === 0
  const activeHours = Number(filterParams.last_hours ?? timeRange.lastHours)
  const windowLabel = formatHoursLabel(activeHours)

  // Mirror the active window into the related chart so the fingerprint-occurrence
  // chart tracks the same range as the table. The duration threshold is
  // table-only — it has no meaning for an occurrences-over-time chart. Charts
  // keep their own per-chart range override, which still wins if the user sets it.
  const relatedChartsWithWindow = useMemo(() => {
    const base = expensiveQueriesConfig.relatedCharts as
      | (string | [string, Omit<ChartProps, 'hostId'>])[]
      | undefined
    if (!base) return base
    const matched = TIME_RANGE_PRESETS.find((p) => p.lastHours === activeHours)
    return base.map((c): string | [string, Omit<ChartProps, 'hostId'>] =>
      Array.isArray(c)
        ? [
            c[0],
            {
              ...c[1],
              lastHours: activeHours,
              ...(matched ? { interval: matched.interval } : {}),
            },
          ]
        : c
    )
  }, [activeHours])

  const explainItems = rows.slice(0, 20).map((r) => ({
    sql: String(r.query ?? ''),
    title: truncateSql(String(r.query ?? ''), 60),
    readRows: Number(r.read_rows ?? 0),
    resultRows: Number(r.result_rows ?? 0),
  }))

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <PageHeader
          title={
            <div className="flex items-center gap-2">
              <Flame className="size-5 text-rose-500" />
              Most Expensive Queries
              <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium tabular-nums text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                {rows.length}
              </span>
            </div>
          }
          description={`Top query fingerprints by cost over the last ${windowLabel} · aggregated from system.query_log`}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {expensiveQueriesConfig.relatedCharts &&
                expensiveQueriesConfig.relatedCharts.length > 0 && (
                  <HeaderButton onClick={() => setChartsOpen((v) => !v)}>
                    {chartsOpen ? (
                      <MinimizeIcon className="size-3.5" />
                    ) : (
                      <LayoutDashboardIcon className="size-3.5" />
                    )}
                    {chartsOpen ? 'Collapse charts' : 'Expand charts'}
                  </HeaderButton>
                )}
              <HeaderButton
                onClick={() => setExplainOpen(true)}
                disabled={rows.length === 0}
              >
                <ScanSearch className="size-3.5" />
                Explain top N
              </HeaderButton>
              <HeaderButton onClick={() => refresh()} disabled={isValidating}>
                <RefreshCw
                  className={cn('size-3.5', isValidating && 'animate-spin')}
                />
                Refresh
              </HeaderButton>
            </div>
          }
        />

        {/* Filter bar — time window + minimum per-query duration. */}
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
        {showSkeleton ? (
          <QueryPageSkeleton />
        ) : error && rows.length === 0 ? (
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <EmptyState
                variant={toEmptyStateVariant(
                  detectCardErrorVariant(error as CardError)
                )}
                title={getCardErrorTitle(
                  detectCardErrorVariant(error as CardError),
                  'Expensive Queries'
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
            {/* Heavy-vs-light load summary, derived from the fetched rows. */}
            {rows.length > 0 && <LoadSummary rows={rows} />}
            {expensiveQueriesConfig.relatedCharts &&
              expensiveQueriesConfig.relatedCharts.length > 0 &&
              (chartsOpen ? (
                <RelatedCharts relatedCharts={relatedChartsWithWindow} />
              ) : (
                <CollapsedChartsRow
                  labels={expensiveQueriesConfig.relatedCharts
                    .filter(
                      (c): c is Exclude<typeof c, 'break' | null | undefined> =>
                        Boolean(c) && c !== 'break'
                    )
                    .map((c) => {
                      const name = Array.isArray(c) ? c[0] : (c as string)
                      const props = Array.isArray(c)
                        ? (c[1] as { title?: string } | undefined)
                        : undefined
                      return props?.title ?? name.replace(/-/g, ' ')
                    })}
                  onExpand={() => setChartsOpen(true)}
                />
              ))}
            {rows.length === 0 ? (
              <Card className="rounded-xl border-dashed">
                <CardContent className="p-6">
                  <EmptyState
                    variant="no-data"
                    title="No expensive queries"
                    description={`Nothing matched in the last ${windowLabel} on this host. Try widening the time window or lowering the minimum duration.`}
                  />
                </CardContent>
              </Card>
            ) : (
              <ExpensiveQueriesTable rows={rows} />
            )}
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
