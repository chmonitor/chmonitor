/**
 * Query-pattern detail flyout, scoped to one `normalized_query_hash`. Overview reads
 * the clicked row directly. "Notable" runs use the endpoint's server-ranked `notable`
 * list, not a client sort of `executions`, which is capped at 200 rows and would
 * misrank hot patterns. A `withinHours:N` page filter maps to the endpoint's `range`;
 * anything else falls back to its 24h default (see {@link resolveRangeHours}).
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
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import {
  isValidQueryHash,
  type NotableRunReason,
} from '@/lib/api/insights/query-patterns'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { formatDuration } from '@/lib/utils'

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
    notable: Array<PatternExecutionRow & { reason: NotableRunReason }>
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

function PatternDetailSheetContent({
  pattern,
}: {
  pattern: Record<string, unknown>
}) {
  const hostId = useHostId()
  const searchParams = useUrlSearchParams()

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
    const notable = detailData?.data.notable ?? []
    return {
      recent: (detailData?.data.executions ?? []).slice(0, 20),
      // Server-ranked (see buildPatternNotableRunsConfig) — NOT sliced from
      // `executions`, which is capped and would misrank hot patterns.
      slowest: notable.filter((r) => r.reason === 'slowest'),
      largest_result: notable.filter((r) => r.reason === 'largest_result'),
      errored: notable.filter((r) => r.reason === 'errored'),
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
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={explorerHref} />}
          >
            <ExternalLinkIcon className="mr-1.5 size-3.5" />
            Open in Explorer
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={explainHref} />}
          >
            <LightbulbIcon className="mr-1.5 size-3.5" />
            Explain
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
  pattern: Record<string, unknown> | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

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
