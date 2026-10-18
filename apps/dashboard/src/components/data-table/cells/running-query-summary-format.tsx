import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Clock3,
  Cpu,
  Database,
  Fingerprint,
  HardDriveDownload,
  HardDriveUpload,
  MemoryStick,
  Monitor,
  Network,
  Server,
  User,
} from 'lucide-react'
import type { Row, RowData } from '@tanstack/react-table'

import { CodeDialogFormat } from '@/components/data-table/cells/code-dialog-format'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

interface RunningQuerySummaryFormatProps<TData extends RowData> {
  row: Row<TData>
  value: React.ReactNode
  context?: Record<string, string>
}

interface MetricItemProps {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  subValue?: React.ReactNode
  tone?: 'default' | 'warning' | 'danger'
}

interface DetailItemProps {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  title?: string
}

const numberFormatter = new Intl.NumberFormat('en-US')

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value) !== ''
}

function stringValue(value: unknown): string {
  if (!hasValue(value)) return ''
  return String(value)
}

function numberValue(value: unknown): number | null {
  if (!hasValue(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readableSize(value: unknown): string {
  const parsed = numberValue(value)
  return parsed === null ? '' : formatReadableSize(parsed)
}

function readableCount(value: unknown): string {
  const parsed = numberValue(value)
  return parsed === null ? '' : formatReadableQuantity(parsed)
}

function getThreadCount(row: Record<string, unknown>): string {
  const peakThreads = numberValue(row.peak_threads_usage)
  if (peakThreads !== null) return numberFormatter.format(peakThreads)

  const threadCount = numberValue(row.thread_count)
  if (threadCount !== null) return numberFormatter.format(threadCount)

  if (Array.isArray(row.thread_ids)) {
    return numberFormatter.format(row.thread_ids.length)
  }

  return ''
}

function getElapsedTone(elapsed: number | null): MetricItemProps['tone'] {
  if (elapsed === null) return 'default'
  if (elapsed > 30) return 'danger'
  if (elapsed > 5) return 'warning'
  return 'default'
}

function MetricItem({
  icon: Icon,
  label,
  value,
  subValue,
  tone = 'default',
}: MetricItemProps) {
  if (!hasValue(value)) return null

  return (
    <div
      className={cn(
        'min-w-0 rounded-md border bg-background/70 px-2.5 py-2',
        tone === 'warning' && 'border-amber-300/70 bg-amber-50/70',
        tone === 'danger' && 'border-red-300/70 bg-red-50/70',
        tone === 'warning' && 'dark:border-amber-800/70 dark:bg-amber-950/20',
        tone === 'danger' && 'dark:border-red-800/70 dark:bg-red-950/20'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 min-w-0 truncate text-sm font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {hasValue(subValue) && (
        <div className="mt-0.5 min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">
          {subValue}
        </div>
      )}
    </div>
  )
}

function DetailItem({ icon: Icon, label, value, title }: DetailItemProps) {
  if (!hasValue(value)) return null

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground/70">{label}</span>
      <span className="min-w-0 truncate font-mono" title={title}>
        {value}
      </span>
    </div>
  )
}

export const RunningQuerySummaryFormat = function RunningQuerySummaryFormat<
  TData extends RowData,
>({ row, value }: RunningQuerySummaryFormatProps<TData>): React.ReactNode {
  const record = row.original as Record<string, unknown>
  const hostId = useHostId()
  const query = stringValue(record.query ?? value)
  const queryId = stringValue(record.query_id ?? record.query_detail)
  const initialQueryId = stringValue(record.initial_query_id)
  const normalizedQueryHash = stringValue(record.normalized_query_hash)
  const elapsed = numberValue(record.elapsed)
  const elapsedLabel =
    stringValue(record.readable_elapsed) ||
    (elapsed === null ? '' : `${elapsed.toFixed(1)} seconds`)
  const progress = stringValue(record.progress)
  const memory =
    stringValue(record.readable_memory_usage) ||
    readableSize(record.memory_usage)
  const readRows =
    stringValue(record.readable_read_rows) || readableCount(record.read_rows)
  const readBytes =
    stringValue(record.readable_read_bytes) || readableSize(record.read_bytes)
  const writtenRows =
    stringValue(record.readable_written_rows) ||
    readableCount(record.written_rows)
  const writtenBytes =
    stringValue(record.readable_written_bytes) ||
    readableSize(record.written_bytes)
  const threadCount = getThreadCount(record)
  const merges = stringValue(record.launched_merges)
  const queryKind = stringValue(record.query_kind)
  const user = stringValue(record.user)
  const database = stringValue(record.current_database)
  const interfaceLabel =
    stringValue(record.interface_label) || stringValue(record.interface)
  const client = stringValue(record.client_name)
  const clientHost = stringValue(record.client_hostname)
  const address = stringValue(record.address)
  const port = stringValue(record.port)
  const addressLabel = address && port ? `${address}:${port}` : address
  const distributedDepth = numberValue(record.distributed_depth)
  const isDistributed = (distributedDepth ?? 0) > 0

  const queryLink = (() => {
    if (!queryId) return ''
    return `/query?query_id=${encodeURIComponent(queryId)}&host=${encodeURIComponent(hostId)}`
  })()

  return (
    <div data-slot="running-query-summary" className="min-w-0 py-2 pr-2">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {queryKind && (
              <Badge
                variant="secondary"
                className="h-6 shrink-0 rounded-md px-2 font-mono text-[11px] uppercase"
              >
                {queryKind}
              </Badge>
            )}
            {user && (
              <Badge
                variant="outline"
                className="h-6 max-w-36 shrink-0 rounded-md px-2 text-[11px]"
              >
                <User className="mr-1 size-3" aria-hidden="true" />
                <span className="truncate">{user}</span>
              </Badge>
            )}
            {database && (
              <Badge
                variant="outline"
                className="h-6 max-w-44 shrink-0 rounded-md px-2 text-[11px]"
              >
                <Database className="mr-1 size-3" aria-hidden="true" />
                <span className="truncate font-mono">{database}</span>
              </Badge>
            )}
            {isDistributed && (
              <Badge
                variant="outline"
                className="h-6 shrink-0 rounded-md px-2 text-[11px]"
              >
                Distributed depth {distributedDepth}
              </Badge>
            )}
          </div>

          <div className="mt-2 min-w-0 [&_code]:break-words [&_code]:whitespace-normal">
            <CodeDialogFormat
              value={query}
              options={{
                dialog_title: 'Running Query',
                hide_query_comment: true,
                max_truncate: 320,
                force_dialog: true,
                show_query_plan: true,
                trigger_classname:
                  'w-full min-w-0 justify-start rounded-md border border-transparent bg-muted/30 px-2 py-1.5 hover:border-border hover:bg-muted/60',
              }}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-start gap-2 xl:max-w-[28rem] xl:justify-end">
          {queryLink && (
            <Link
              href={queryLink}
              className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Fingerprint className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate font-mono">
                {queryId.slice(0, 18)}
                {queryId.length > 18 ? '...' : ''}
              </span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <MetricItem
          icon={Clock3}
          label="Elapsed"
          value={elapsedLabel}
          tone={getElapsedTone(elapsed)}
        />
        <MetricItem icon={MemoryStick} label="Memory" value={memory} />
        <MetricItem
          icon={Activity}
          label="Progress"
          value={progress}
          subValue={
            numberValue(record.total_rows_approx) !== null
              ? `${readRows} of ${readableCount(record.total_rows_approx)} rows`
              : undefined
          }
        />
        <MetricItem
          icon={HardDriveDownload}
          label="Read"
          value={readRows}
          subValue={readBytes}
        />
        <MetricItem
          icon={HardDriveUpload}
          label="Written"
          value={writtenRows}
          subValue={writtenBytes}
        />
        <MetricItem
          icon={Cpu}
          label={
            hasValue(record.peak_threads_usage) ? 'Peak threads' : 'Threads'
          }
          value={threadCount}
          subValue={
            hasValue(record.peak_threads_usage)
              ? 'from system.processes'
              : undefined
          }
        />
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem icon={Monitor} label="Client" value={client} />
        <DetailItem icon={Server} label="Host" value={clientHost} />
        <DetailItem icon={Network} label="Interface" value={interfaceLabel} />
        <DetailItem
          icon={Network}
          label="Address"
          value={addressLabel}
          title={addressLabel}
        />
        <DetailItem
          icon={Fingerprint}
          label="Initial"
          value={
            initialQueryId && initialQueryId !== queryId
              ? initialQueryId
              : undefined
          }
          title={initialQueryId}
        />
        <DetailItem
          icon={Fingerprint}
          label="Hash"
          value={normalizedQueryHash}
          title={normalizedQueryHash}
        />
        <DetailItem
          icon={Activity}
          label="Merges"
          value={merges && merges !== '0' ? merges : undefined}
        />
      </div>
    </div>
  )
} as <TData extends RowData>(
  props: RunningQuerySummaryFormatProps<TData>
) => React.ReactNode
