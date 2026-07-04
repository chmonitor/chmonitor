/**
 * Query-pattern detail flyout (#2262). Clicking a row on the Slow Query
 * Patterns table (#2261) opens this Sheet, scoped to that row's
 * `normalized_query_hash`:
 *
 * - Overview: aggregate stat cards straight from the clicked row — the
 *   slow-query-patterns query already computed calls / duration percentiles /
 *   resource usage / errors for this exact pattern under the page's active
 *   filters and time range, so no extra query is needed here.
 * - Recent / Notable runs: `GET /api/v1/insights/query-patterns/:hash`
 *   (#2266) — reused rather than duplicating a second "executions for one
 *   pattern" query. "Notable" (slowest / largest result / errored) is
 *   derived client-side from that same up-to-200-row response, the same
 *   window cap the endpoint itself already applies.
 * - Advisor: reuses `/api/v1/advisor` + `AdvisorRecommendationsPanel`, the
 *   same engine and renderer as the `/advisor` page.
 *
 * Respects the host page's active `event_time` filter by translating a
 * `withinHours:N` value into the endpoint's `range` (hours) param — the only
 * time-window shape it accepts (see {@link resolveRangeHours}).
 */
import { ExternalLinkIcon, LightbulbIcon, WandSparklesIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { AdvisorRecommendationsOutput } from '@/components/agents/advisor-recommendations-panel'
import type { PatternExecutionRow } from '@/components/slow-query-patterns/pattern-executions-list'

import { useMemo } from 'react'
import { AdvisorRecommendationsPanel } from '@/components/agents/advisor-recommendations-panel'
import { ExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { PatternExecutionsList } from '@/components/slow-query-patterns/pattern-executions-list'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isValidQueryHash } from '@/lib/api/insights/query-patterns'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { useSearchParams } from '@/lib/next-compat'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { formatDuration } from '@/lib/utils'

/** Duration fields on a slow-query-patterns row that need seconds→"1.2s"
 * formatting — unlike the size/row-count fields, these have no
 * `readable_<key>` companion column from the SQL. */
const DURATION_KEYS = [
  'p50_duration',
  'p95_duration',
  'p99_duration',
  'max_duration',
  'cpu_time',
] as const

/** Add `<key>_display` companions for the overview stat tiles so
 * `ExpandedPanel`'s generic `displayValue()` (raw value, or a
 * `readable_<key>` companion) renders properly formatted numbers instead of
 * unrounded floats. */
function buildStatDisplayRow(
  pattern: Record<string, unknown>
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...pattern }
  for (const key of DURATION_KEYS) {
    row[`${key}_display`] = formatDuration(Number(pattern[key] ?? 0) * 1000)
  }
  row.calls_display = Number(pattern.calls ?? 0).toLocaleString()
  row.errors_display = Number(pattern.errors ?? 0).toLocaleString()
  row.cache_hit_ratio_display = `${Number(pattern.cache_hit_ratio ?? 0)}%`
  return row
}

/**
 * Translate the host page's active `event_time` filter (`operator:value`,
 * see `lib/filters/url-state.ts`) into the hours the insights detail
 * endpoint's `range` param expects. It only understands a relative-hours
 * window, so an explicit `between`/`gte`/`lte` date-range filter on the page
 * can't be translated exactly — falls back to the endpoint's own 24h default
 * in that case (and when no filter is active).
 */
function resolveRangeHours(eventTimeParam: string | null): number | null {
  if (!eventTimeParam?.startsWith('withinHours:')) return null
  const hours = Number(eventTimeParam.slice('withinHours:'.length))
  return Number.isFinite(hours) && hours > 0 ? hours : null
}

interface PatternDetailApiResponse {
  success: true
  data: {
    pattern: Record<string, unknown>
    executions: PatternExecutionRow[]
  }
}
interface AdvisorApiResponse extends AdvisorRecommendationsOutput {
  success: true
}
interface ApiErrorResponse {
  success: false
  error: { message: string } | string
}

function errorMessage(body: ApiErrorResponse, fallback: string): string {
  return typeof body.error === 'string'
    ? body.error
    : body.error.message || fallback
}

async function fetchPatternDetail(
  url: string
): Promise<PatternDetailApiResponse> {
  const res = await apiFetch(url)
  const body = (await res.json()) as PatternDetailApiResponse | ApiErrorResponse
  if (!res.ok || !body.success) {
    throw new Error(
      errorMessage(
        body as ApiErrorResponse,
        `Failed to load pattern detail (HTTP ${res.status})`
      )
    )
  }
  return body
}

async function fetchAdvisor(url: string): Promise<AdvisorApiResponse> {
  const res = await apiFetch(url)
  const body = (await res.json()) as AdvisorApiResponse | ApiErrorResponse
  if (!res.ok || !body.success) {
    throw new Error(
      errorMessage(
        body as ApiErrorResponse,
        `Analysis failed (HTTP ${res.status})`
      )
    )
  }
  return body
}

/** Best-effort top-N helper for the "Notable runs" tab — sorts a copy so the
 * caller's array/order (reverse-chronological, as the API returns it) is
 * untouched for the "Recent" tab. */
function topN<T>(rows: T[], by: (row: T) => number, n: number): T[] {
  return [...rows].sort((a, b) => by(b) - by(a)).slice(0, n)
}

/** Only mounted while the Sheet is open — gates the drilldown/advisor fetches. */
function PatternDetailSheetContent({
  pattern,
}: {
  pattern: Record<string, unknown>
}) {
  const hostId = useHostId()
  const searchParams = useSearchParams()

  const normalizedQuery = String(pattern.normalized_query ?? '')
  const normalizedQueryHash = String(
    pattern.normalized_query_hash_str ?? pattern.normalized_query_hash ?? ''
  )

  const rangeHours = resolveRangeHours(searchParams.get('event_time'))
  const detailUrl = isValidQueryHash(normalizedQueryHash)
    ? `/api/v1/insights/query-patterns/${normalizedQueryHash}?${new URLSearchParams(
        {
          hostId: String(hostId),
          ...(rangeHours ? { range: String(rangeHours) } : {}),
        }
      ).toString()}`
    : null

  const {
    data: detailData,
    isLoading: isDrilldownLoading,
    error: drilldownError,
  } = useQuery<PatternDetailApiResponse>({
    queryKey: ['pattern-detail-executions', detailUrl],
    queryFn: () => fetchPatternDetail(detailUrl as string),
    enabled: Boolean(detailUrl),
  })

  const byReason = useMemo(() => {
    const executions = detailData?.data.executions ?? []
    return {
      // Already reverse-chronological from the API.
      recent: executions.slice(0, 20),
      slowest: topN(executions, (r) => Number(r.query_duration_ms || 0), 5),
      largest_result: topN(executions, (r) => Number(r.result_rows || 0), 5),
      errored: executions
        .filter((r) => Number(r.exception_code || 0) !== 0)
        .slice(0, 5),
    }
  }, [detailData])

  const advisorUrl = normalizedQuery
    ? `/api/v1/advisor?${new URLSearchParams({ hostId: String(hostId), sql: normalizedQuery }).toString()}`
    : null

  const {
    data: advisorData,
    error: advisorError,
    isLoading: isAdvisorLoading,
  } = useQuery<AdvisorApiResponse>({
    queryKey: ['pattern-detail-advisor', advisorUrl],
    queryFn: () => fetchAdvisor(advisorUrl as string),
    enabled: Boolean(advisorUrl),
  })

  const explorerHref = buildExplorerQueryUrl(normalizedQuery, hostId)
  const explainHref = `/explain?query=${encodeURIComponent(normalizedQuery)}&host=${hostId}`
  const statDisplayRow = useMemo(() => buildStatDisplayRow(pattern), [pattern])

  return (
    <>
      <SheetHeader className="space-y-3 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle className="text-base">Query pattern</SheetTitle>
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
              {pattern.query_kind ? (
                <Badge variant="secondary">{String(pattern.query_kind)}</Badge>
              ) : null}
              {pattern.database ? (
                <Badge variant="outline">{String(pattern.database)}</Badge>
              ) : null}
              {pattern.user ? (
                <Badge variant="outline">{String(pattern.user)}</Badge>
              ) : null}
            </SheetDescription>
          </div>
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
          {normalizedQuery || '—'}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={explorerHref}>
              <ExternalLinkIcon className="mr-1.5 size-3.5" />
              Open in Explorer
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={explainHref}>
              <LightbulbIcon className="mr-1.5 size-3.5" />
              Explain
            </Link>
          </Button>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-5 py-4">
          <ExpandedPanel
            row={statDisplayRow}
            sections={[
              {
                type: 'stats',
                title: 'This pattern',
                columns: [
                  { key: 'calls_display', label: 'Calls' },
                  { key: 'p50_duration_display', label: 'p50 duration' },
                  { key: 'p95_duration_display', label: 'p95 duration' },
                  { key: 'p99_duration_display', label: 'p99 duration' },
                  { key: 'max_duration_display', label: 'Max duration' },
                  { key: 'cpu_time_display', label: 'CPU time' },
                  { key: 'peak_memory', label: 'Peak memory' },
                  { key: 'read_rows', label: 'Read rows' },
                  { key: 'read_bytes', label: 'Read bytes' },
                  { key: 'result_rows', label: 'Result rows' },
                  { key: 'errors_display', label: 'Errors' },
                  {
                    key: 'cache_hit_ratio_display',
                    label: 'Cache hit ratio',
                  },
                ],
              },
              {
                type: 'bars',
                title: 'Share of all patterns in this window',
                columns: [
                  { key: 'calls', label: 'Calls', pctKey: 'pct_calls' },
                  {
                    key: 'peak_memory',
                    label: 'Peak memory',
                    pctKey: 'pct_peak_memory',
                  },
                  {
                    key: 'read_bytes',
                    label: 'Read bytes',
                    pctKey: 'pct_read_bytes',
                  },
                ],
              },
            ]}
          />

          <Separator />

          <Tabs defaultValue="recent">
            <TabsList>
              <TabsTrigger value="recent">Recent</TabsTrigger>
              <TabsTrigger value="notable">Notable runs</TabsTrigger>
              <TabsTrigger value="advisor">
                <WandSparklesIcon className="mr-1.5 size-3.5" />
                Advisor
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="pt-3">
              {isDrilldownLoading ? (
                <TableSkeleton rows={4} />
              ) : drilldownError ? (
                <ErrorAlert
                  title="Failed to load recent executions"
                  message={
                    drilldownError instanceof Error
                      ? drilldownError.message
                      : String(drilldownError)
                  }
                />
              ) : (
                <PatternExecutionsList
                  rows={byReason.recent}
                  hostId={hostId}
                  emptyMessage="No executions of this pattern in the current time range."
                />
              )}
            </TabsContent>

            <TabsContent value="notable" className="space-y-4 pt-3">
              {isDrilldownLoading ? (
                <TableSkeleton rows={4} />
              ) : drilldownError ? (
                <ErrorAlert
                  title="Failed to load notable runs"
                  message={
                    drilldownError instanceof Error
                      ? drilldownError.message
                      : String(drilldownError)
                  }
                />
              ) : (
                <>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Slowest
                    </h4>
                    <PatternExecutionsList
                      rows={byReason.slowest}
                      hostId={hostId}
                      emptyMessage="No executions found."
                    />
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Largest result
                    </h4>
                    <PatternExecutionsList
                      rows={byReason.largest_result}
                      hostId={hostId}
                      emptyMessage="No executions found."
                    />
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Errored
                    </h4>
                    <PatternExecutionsList
                      rows={byReason.errored}
                      hostId={hostId}
                      emptyMessage="No errored executions in the current time range."
                    />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="advisor" className="pt-3">
              {isAdvisorLoading ? (
                <TableSkeleton rows={3} />
              ) : advisorError ? (
                <ErrorAlert
                  title="Analysis failed"
                  message={
                    advisorError instanceof Error
                      ? advisorError.message
                      : String(advisorError)
                  }
                />
              ) : advisorData ? (
                advisorData.recommendations.length === 0 ? (
                  <EmptyState
                    variant="no-data"
                    title="No recommendations"
                    description="This pattern looks well-tuned for the table's current schema."
                    compact
                  />
                ) : (
                  <AdvisorRecommendationsPanel output={advisorData} />
                )
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </>
  )
}

export interface PatternDetailSheetProps {
  /** The clicked slow-query-patterns row, or `null` when nothing is selected. */
  pattern: Record<string, unknown> | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Flyout shell. Kept separate from {@link PatternDetailSheetContent} so the
 * drilldown/advisor queries only mount (and fetch) while the Sheet is open.
 */
export function PatternDetailSheet({
  pattern,
  open,
  onOpenChange,
}: PatternDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl"
      >
        {open && pattern ? (
          <PatternDetailSheetContent pattern={pattern} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
