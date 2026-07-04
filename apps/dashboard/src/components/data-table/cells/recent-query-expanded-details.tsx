import {
  AlertTriangleIcon,
  ClockIcon,
  DatabaseIcon,
  FingerprintIcon,
  GaugeIcon,
  MemoryStickIcon,
  MonitorIcon,
  RowsIcon,
  TimerIcon,
  UserIcon,
} from 'lucide-react'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface RecentQueryExpandedDetailsProps {
  row: Record<string, unknown>
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value) !== ''
}

function toStringSafe(value: unknown): string {
  return hasValue(value) ? String(value) : ''
}

function toNumberOrNull(value: unknown): number | null {
  if (!hasValue(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatDuration(row: Record<string, unknown>): string {
  const seconds = toNumberOrNull(row.query_duration)
  if (seconds === null) return ''
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`
  return `${seconds.toFixed(2)} s`
}

interface DetailFieldProps {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  mono?: boolean
  className?: string
}

function DetailField({
  label,
  value,
  icon: Icon,
  mono = false,
  className,
}: DetailFieldProps) {
  if (!hasValue(value)) return null

  return (
    <div
      className={cn(
        'min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 min-w-0 truncate text-sm text-foreground',
          mono && 'font-mono',
          'tabular-nums'
        )}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Inline expanded-row detail panel for the recent-queries table.
 *
 * The collapsed row truncates the SQL (`CodeDialog max_truncate`) and shows
 * only compact metrics; expanding surfaces the full, syntax-highlighted query,
 * the row's identity + runtime metrics in a clean grid, and — for failed rows
 * (non-zero `exception_code`) — the full exception message, which is the single
 * most valuable field to read when a query errored.
 */
export const RecentQueryExpandedDetails = function RecentQueryExpandedDetails({
  row,
}: RecentQueryExpandedDetailsProps) {
  const query = toStringSafe(row.query)
  const queryId = toStringSafe(row.query_id)
  const user = toStringSafe(row.user)
  const database = toStringSafe(row.database)
  const queryKind = toStringSafe(row.query_kind)
  const clientName = toStringSafe(row.client_name)
  const eventTime = toStringSafe(row.event_time)
  const duration = formatDuration(row)
  const readRows = toStringSafe(row.readable_read_rows)
  const readBytes = toStringSafe(row.readable_read_bytes)
  const resultRows = toStringSafe(row.readable_result_rows)
  const memory = toStringSafe(row.readable_memory_usage)

  const exceptionCode = toNumberOrNull(row.exception_code) ?? 0
  const exception = toStringSafe(row.exception)
  const failed = exceptionCode !== 0

  return (
    <div
      data-slot="recent-query-expanded"
      className="border-t border-border/60 bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {queryKind && (
          <Badge
            variant="secondary"
            className="font-mono text-[10.5px] uppercase"
          >
            {queryKind}
          </Badge>
        )}
        {database && (
          <Badge variant="outline" className="font-mono text-[10.5px]">
            {database}
          </Badge>
        )}
        {failed && (
          <Badge
            variant="outline"
            className="gap-1 border-red-500/40 font-mono text-[10.5px] text-red-600 dark:text-red-400"
          >
            <AlertTriangleIcon className="size-3" aria-hidden="true" />
            exit code {exceptionCode}
          </Badge>
        )}
      </div>

      {failed && exception && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-50/60 p-3 dark:bg-red-950/30">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
            <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
            <span>Exception</span>
          </div>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-red-700 dark:text-red-300">
            {exception}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <DetailField
          icon={FingerprintIcon}
          label="Query ID"
          value={queryId}
          mono
          className="xl:col-span-2"
        />
        <DetailField icon={UserIcon} label="User" value={user} />
        <DetailField icon={DatabaseIcon} label="Database" value={database} />
        <DetailField icon={ClockIcon} label="Event time" value={eventTime} />
        <DetailField icon={TimerIcon} label="Duration" value={duration} />
        <DetailField icon={RowsIcon} label="Read rows" value={readRows} />
        <DetailField icon={GaugeIcon} label="Read bytes" value={readBytes} />
        <DetailField icon={RowsIcon} label="Result rows" value={resultRows} />
        <DetailField
          icon={MemoryStickIcon}
          label="Peak memory"
          value={memory}
        />
        <DetailField icon={MonitorIcon} label="Client" value={clientName} />
      </div>

      {query && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Query</span>
          </div>
          <CodeBlock code={query} language="sql" className="text-xs">
            <CodeBlockCopyButton />
          </CodeBlock>
        </div>
      )}
    </div>
  )
}
