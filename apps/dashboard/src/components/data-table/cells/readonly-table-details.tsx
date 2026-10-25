import {
  AlertTriangleIcon,
  ClockIcon,
  DatabaseIcon,
  NetworkIcon,
  ServerIcon,
  TimerIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface ReadonlyTableDetailsProps {
  row: Record<string, unknown>
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function toStringSafe(value: unknown): string {
  return hasValue(value) ? String(value) : ''
}

interface DetailFieldProps {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  mono?: boolean
  wrap?: boolean
  className?: string
}

function DetailField({
  label,
  value,
  icon: Icon,
  mono = false,
  wrap = false,
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
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 min-w-0 text-sm text-foreground tabular-nums',
          mono && 'font-mono',
          wrap ? 'whitespace-pre-wrap break-words' : 'truncate'
        )}
        title={!wrap && typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

export const ReadonlyTableDetails = function ReadonlyTableDetails({
  row,
}: ReadonlyTableDetailsProps) {
  const zkException = toStringSafe(row.zookeeper_exception)
  const queueException = toStringSafe(row.last_queue_update_exception)
  const isSessionExpired = toStringSafe(row.is_session_expired)
  const absoluteDelay = toStringSafe(row.absolute_delay)
  const logPointer = toStringSafe(row.log_pointer)
  const replicaPath = toStringSafe(row.replica_path)
  const activeReplicas = toStringSafe(row.active_replicas)
  const totalReplicas = toStringSafe(row.total_replicas)
  const zkPath = toStringSafe(row.zookeeper_path)

  const replicaRatio =
    hasValue(activeReplicas) && hasValue(totalReplicas)
      ? `${activeReplicas} / ${totalReplicas}`
      : ''

  return (
    <div
      data-slot="readonly-table-expanded"
      className="border-t border-border/60 bg-muted/20 p-4"
    >
      <div className="flex flex-col gap-3">
        {hasValue(zkException) && (
          <DetailField
            icon={AlertTriangleIcon}
            label="ZooKeeper Exception"
            value={zkException}
            mono
            wrap
            className="border-amber-300/60 bg-amber-50/40 dark:border-amber-700/40 dark:bg-amber-950/20"
          />
        )}
        {hasValue(queueException) && (
          <DetailField
            icon={AlertTriangleIcon}
            label="Last Queue Update Exception"
            value={queueException}
            mono
            wrap
            className="border-amber-300/60 bg-amber-50/40 dark:border-amber-700/40 dark:bg-amber-950/20"
          />
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DetailField
            icon={TimerIcon}
            label="Absolute Delay (s)"
            value={absoluteDelay}
            mono
          />
          <DetailField
            icon={ClockIcon}
            label="Session Expired"
            value={isSessionExpired}
            mono
          />
          <DetailField
            icon={DatabaseIcon}
            label="Log Pointer"
            value={logPointer}
            mono
          />
          <DetailField
            icon={NetworkIcon}
            label="Active / Total Replicas"
            value={replicaRatio}
            mono
          />
          <DetailField
            icon={ServerIcon}
            label="Replica Path"
            value={replicaPath}
            mono
            className="sm:col-span-2"
          />
          <DetailField
            icon={DatabaseIcon}
            label="ZooKeeper Path"
            value={zkPath}
            mono
            className="sm:col-span-2"
          />
        </div>
      </div>
    </div>
  )
}
