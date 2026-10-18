import {
  ActivityIcon,
  Clock3Icon,
  FingerprintIcon,
  MemoryStickIcon,
  NetworkIcon,
  UserIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { cn } from '@/lib/utils'

interface RunningQueryExpandedDetailsProps {
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

function formatElapsed(value: unknown): string {
  const readable = toStringSafe(
    (value as Record<string, unknown>)?.readable_elapsed
  )
  if (readable) return readable
  const seconds = toNumberOrNull((value as Record<string, unknown>)?.elapsed)
  return seconds === null ? '' : `${seconds.toFixed(1)} s`
}

function formatMemory(row: Record<string, unknown>): string {
  const readable = toStringSafe(row.readable_memory_usage)
  if (readable) return readable
  const bytes = toNumberOrNull(row.memory_usage)
  return bytes === null ? '' : formatReadableSize(bytes)
}

function formatAddress(row: Record<string, unknown>): string {
  const address = toStringSafe(row.address)
  const port = toStringSafe(row.port)
  if (address && port) return `${address}:${port}`
  return address
}

function formatProfileEventValue(key: string, value: number): string {
  const lower = key.toLowerCase()
  if (lower.includes('bytes')) return formatReadableSize(value)
  if (lower.includes('microseconds')) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} s`
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)} ms`
    return `${value} us`
  }
  if (lower.includes('milliseconds')) {
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)} s`
    return `${value} ms`
  }
  if (lower.includes('nanoseconds')) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} s`
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ms`
    return `${value} ns`
  }
  return formatReadableQuantity(value)
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

export const RunningQueryExpandedDetails =
  function RunningQueryExpandedDetails({
    row,
  }: RunningQueryExpandedDetailsProps) {
    const queryId = toStringSafe(row.query_id)
    const initialQueryId = toStringSafe(row.initial_query_id)
    const user = toStringSafe(row.user)
    const osUser = toStringSafe(row.os_user)
    const address = formatAddress(row)
    const elapsed = formatElapsed(row)
    const memory = formatMemory(row)
    const queryKind = toStringSafe(row.query_kind)
    const database = toStringSafe(row.current_database)
    const interfaceLabel =
      toStringSafe(row.interface_label) || toStringSafe(row.interface)

    const profileEntries = (() => {
      const raw = row.ProfileEvents
      if (!raw || typeof raw !== 'object') return [] as Array<[string, number]>
      const entries = Object.entries(raw as Record<string, unknown>)
        .map(([k, v]) => [k, Number(v)] as [string, number])
        .filter(([, v]) => Number.isFinite(v) && v !== 0)
      entries.sort((a, b) => b[1] - a[1])
      return entries
    })()

    return (
      <div
        data-slot="running-query-expanded"
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
          {interfaceLabel && (
            <Badge variant="outline" className="text-[10.5px]">
              {interfaceLabel}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DetailField
            icon={FingerprintIcon}
            label="Query ID"
            value={queryId}
            mono
            className="xl:col-span-2"
          />
          <DetailField icon={UserIcon} label="User" value={user} />
          <DetailField
            icon={UserIcon}
            label="OS user"
            value={osUser && osUser !== user ? osUser : undefined}
          />
          <DetailField
            icon={NetworkIcon}
            label="Address"
            value={address}
            mono
          />
          <DetailField icon={Clock3Icon} label="Elapsed" value={elapsed} />
          <DetailField icon={MemoryStickIcon} label="Memory" value={memory} />
          <DetailField
            icon={FingerprintIcon}
            label="Initial query"
            value={
              initialQueryId && initialQueryId !== queryId
                ? initialQueryId
                : undefined
            }
            mono
            className="xl:col-span-2"
          />
        </div>

        {profileEntries.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ActivityIcon className="size-3.5" aria-hidden="true" />
              <span>ProfileEvents</span>
              <Badge variant="outline" className="ml-1 text-[10px]">
                {profileEntries.length}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-border/60 bg-background/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {profileEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-baseline justify-between gap-2 text-[11.5px]"
                >
                  <span
                    className="min-w-0 truncate font-mono text-muted-foreground"
                    title={key}
                  >
                    {key}
                  </span>
                  <span className="shrink-0 font-mono font-medium tabular-nums">
                    {formatProfileEventValue(key, value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
