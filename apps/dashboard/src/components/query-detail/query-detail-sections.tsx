import {
  AlertCircle,
  Clock,
  Database,
  ExternalLink,
  HardDrive,
  Lightbulb,
  ListTree,
  MemoryStick,
  RowsIcon,
  Server,
  User as UserIcon,
} from 'lucide-react'

import type {
  ChildQueryRow,
  QueryDetailRow,
} from '@/components/query-detail/query-detail-types'
import type { QueryInsight } from '@/lib/query/query-insights'

import { KpiCard } from '@/components/overview-charts/kpi-card'
import {
  kindBadgeClass,
  toNumber,
  toStr,
  typeBadgeClass,
} from '@/components/query-detail/query-detail-badges'
import { MetaField } from '@/components/query-detail/query-detail-parts'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  formatReadableSecondDuration,
  formatReadableSize,
} from '@/lib/format-readable'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

/**
 * 1. Header card — query_id, status/type badge, exception, user, times,
 * databases/tables/client, exception + stack trace, and the "Explain query" /
 * "Open in Explorer" actions.
 */
export function QueryDetailHeader({
  row,
  queryId,
  hostId,
  explorerUrl,
}: {
  row: QueryDetailRow
  queryId: string
  hostId: number
  explorerUrl: string
}) {
  const type = toStr(row.type)
  const kind = toStr(row.query_kind)
  const user = toStr(row.user)
  const queryText = toStr(row.query)
  const eventTime = toStr(row.event_time)
  const startTime = toStr(row.query_start_time)
  const finishTime = toStr(row.query_finish_time)
  const databases = toStr(row.databases)
    .replace(/^\[?\s*|\s*\]?,?\s*$/g, '')
    .trim()
  const tables = toStr(row.tables)
    .replace(/^\[?\s*|\s*\]?,?\s*$/g, '')
    .trim()
  const clientName = toStr(row.client_name)
  const clientHost = toStr(row.client_hostname)
  // Lineage: if this is a leaf of a distributed/parallel query, link back to
  // the initial (root) query_id. Empty for root queries themselves.
  const initialQueryId = toStr(row.initial_query_id)
  const stackTrace = toStr(row.stack_trace)
  const hasException = Boolean(
    row.exception_code && Number(row.exception_code) !== 0
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: id + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-[13px] font-semibold text-foreground/90">
            {queryId}
          </code>
          {type && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
                typeBadgeClass(type)
              )}
            >
              {type}
            </span>
          )}
          {kind && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
                kindBadgeClass(kind)
              )}
            >
              {kind}
            </span>
          )}
          {hasException && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              <AlertCircle className="size-3" />
              Error {toStr(row.exception_code)}
            </span>
          )}
        </div>

        {/* Right: actions */}
        {queryText && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              render={
                <Link
                  href={buildUrl('/explain', {
                    query_id: queryId,
                    host: hostId,
                  })}
                />
              }
            >
              <ListTree className="size-3.5" />
              Explain query
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              render={<Link href={explorerUrl} />}
            >
              <ExternalLink className="size-3.5" />
              Open in Explorer
            </Button>
          </div>
        )}
      </div>

      {/* Meta grid */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {user && <MetaField label="User" value={user} icon={UserIcon} />}
        {eventTime && (
          <MetaField label="Logged at" value={eventTime} icon={Clock} />
        )}
        {startTime && startTime !== eventTime && (
          <MetaField label="Started" value={startTime} icon={Clock} />
        )}
        {finishTime && (
          <MetaField label="Finished" value={finishTime} icon={Clock} />
        )}
        {databases && (
          <MetaField label="Databases" value={databases} icon={Database} />
        )}
        {tables && <MetaField label="Tables" value={tables} icon={Server} />}
        {clientName && <MetaField label="Client" value={clientName} />}
        {clientHost && <MetaField label="Client host" value={clientHost} />}
        {initialQueryId && initialQueryId !== queryId && (
          <MetaField
            label="Initial query"
            value={
              <Link
                href={buildUrl('/query', {
                  query_id: initialQueryId,
                  host: hostId,
                })}
                className="font-mono text-[12.5px] hover:underline"
              >
                {initialQueryId}
              </Link>
            }
          />
        )}
      </dl>

      {/* Exception text */}
      {hasException && row.exception_text && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900/40 dark:bg-rose-950/20">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Exception
          </p>
          <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-rose-700 dark:text-rose-300">
            {toStr(row.exception_text)}
          </pre>
        </div>
      )}

      {/* Stack trace (ClickHouse logs it for ExceptionBeforeStart /
          ExceptionWhileProcessing rows). Shown alongside or independently
          of exception_text since it carries the C++ frame breakdown. */}
      {stackTrace && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900/40 dark:bg-rose-950/20">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Stack trace
          </p>
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-rose-700/90 dark:text-rose-300/90">
            {stackTrace}
          </pre>
        </div>
      )}
    </div>
  )
}

/** 2. Metrics strip — KpiCards for duration, read rows, read bytes, memory. */
export function QueryDetailMetrics({ row }: { row: QueryDetailRow }) {
  const durationSecs = toNumber(row.query_duration)
  const readRows = toNumber(row.read_rows)
  const readBytes = toNumber(row.read_bytes)
  const memoryUsage = toNumber(row.memory_usage)
  const peakMemory = toNumber(row.peak_memory_usage)
  const writtenRows = toNumber(row.written_rows)
  const resultRows = toNumber(row.result_rows)

  const readableReadRows =
    toStr(row.readable_read_rows) || readRows.toLocaleString()
  const readableReadBytes =
    toStr(row.readable_read_bytes) || formatReadableSize(readBytes)
  const readableMemory =
    toStr(row.readable_memory_usage) || formatReadableSize(memoryUsage)
  const readablePeakMemory =
    toStr(row.readable_peak_memory_usage) || formatReadableSize(peakMemory)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        icon={Clock}
        tone="amber"
        label="Duration"
        value={formatReadableSecondDuration(durationSecs)}
        sub={`${durationSecs.toFixed(3)}s raw`}
      />
      <KpiCard
        icon={RowsIcon}
        tone="blue"
        label="Rows read"
        value={readableReadRows}
        sub={
          writtenRows > 0
            ? `${toStr(row.readable_written_rows) || writtenRows.toLocaleString()} written`
            : resultRows > 0
              ? `${toStr(row.readable_result_rows) || resultRows.toLocaleString()} result`
              : undefined
        }
      />
      <KpiCard
        icon={HardDrive}
        tone="violet"
        label="Data read"
        value={readableReadBytes}
        sub={
          toStr(row.readable_written_bytes)
            ? `${toStr(row.readable_written_bytes)} written`
            : undefined
        }
      />
      <KpiCard
        icon={MemoryStick}
        tone="green"
        label="Memory"
        value={readableMemory}
        sub={
          peakMemory > 0 && peakMemory !== memoryUsage
            ? `peak ${readablePeakMemory}`
            : undefined
        }
      />
    </div>
  )
}

/** 4. Insights — client-side red flags derived from the row. */
export function QueryDetailInsights({
  insights,
}: {
  insights: QueryInsight[]
}) {
  if (insights.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Lightbulb className="size-3.5" />
        Insights
      </h2>
      <ul className="space-y-2.5">
        {insights.map((insight) => (
          <li key={insight.id} className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                insight.severity === 'critical'
                  ? 'bg-rose-500'
                  : insight.severity === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-sky-500'
              )}
            />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium">{insight.title}</p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {insight.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 6. Child queries — distributed/parallel leaves spawned by this root
 * (initial_query_id match). Linked back into /query detail.
 */
export function QueryDetailChildren({
  childrenData,
  hostId,
}: {
  childrenData: ChildQueryRow[]
  hostId: number
}) {
  if (childrenData.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Child queries
        </span>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {childrenData.length} spawned by this query
        </span>
      </div>
      <ul className="divide-y divide-border">
        {childrenData.map((child) => (
          <li
            key={String(child.query_id)}
            className="flex items-center gap-3 px-4 py-2"
          >
            <Link
              href={buildUrl('/query', {
                query_id: String(child.query_id),
                host: hostId,
              })}
              className="min-w-0 flex-1 truncate font-mono text-[12px] hover:underline"
            >
              {String(child.query_id)}
            </Link>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatReadableSecondDuration(toNumber(child.query_duration))}
            </span>
            {toStr(child.readable_read_rows) && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {toStr(child.readable_read_rows)} rows
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
