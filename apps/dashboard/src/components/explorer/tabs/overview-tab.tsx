'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  Clock,
  Database,
  FileCode2,
  HardDrive,
  Info,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ReactNode } from 'react'

import { ExplorerTuningSection } from '../explorer-tuning-section'
import { useExplorerState } from '../hooks/use-explorer-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  classifyEngine,
  engineKindLabel,
  formatTimestamp,
  hasPartStorage,
  parseMaterializedViewTarget,
} from '@/lib/explorer/engine-kind'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

interface OverviewRow {
  total_bytes?: string | number | null
  total_rows?: string | number | null
  engine?: string | null
  engine_full?: string | null
  sorting_key?: string | null
  partition_key?: string | null
  primary_key?: string | null
  as_select?: string | null
  create_table_query?: string | null
  primary_key_bytes_in_memory?: string | number | null
  primary_key_bytes_in_memory_allocated?: string | number | null
  metadata_modification_time?: string | null
  compressed_bytes?: string | number | null
  uncompressed_bytes?: string | number | null
  active_parts?: string | number | null
  partitions?: string | number | null
  last_modified?: string | null
}

interface DictionaryRow {
  status?: string | null
  type?: string | null
  element_count?: string | number | null
  bytes_allocated?: string | number | null
  load_factor?: string | number | null
  loading_duration?: string | number | null
  loading_start_time?: string | null
  last_successful_update_time?: string | null
  last_exception?: string | null
  source?: string | null
  key_names?: string[] | null
  attribute_names?: string[] | null
  lifetime_min?: string | number | null
  lifetime_max?: string | number | null
}

interface UsageRow {
  queries_24h?: string | number | null
  queries_7d?: string | number | null
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  metadata?: {
    unavailable?: boolean
    [key: string]: unknown
  }
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

const EM_DASH = '—'

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatBytes(value: unknown): string {
  const bytes = toFiniteNumber(value)
  if (bytes === null) return EM_DASH
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const unitIndex = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1
  )
  const scaled = bytes / 1024 ** unitIndex
  const digits = scaled >= 10 || unitIndex === 0 ? 0 : 1

  return `${scaled.toFixed(digits)} ${units[unitIndex]}`
}

function formatNumber(value: unknown): string {
  const n = toFiniteNumber(value)
  return n === null ? EM_DASH : n.toLocaleString()
}

function formatSeconds(value: unknown): string {
  const seconds = toFiniteNumber(value)
  if (seconds === null) return EM_DASH
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 0)}s`
  return `${Math.round(seconds / 60)}m`
}

function formatCompressionRatio(
  compressedValue: unknown,
  uncompressedValue: unknown
): string {
  const compressed = toFiniteNumber(compressedValue)
  const uncompressed = toFiniteNumber(uncompressedValue)

  if (compressed === null || uncompressed === null || compressed === 0) {
    return EM_DASH
  }

  return `${(uncompressed / compressed).toFixed(1)}x`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Compact stat tile: label, value, one optional context line. */
function StatTile({
  label,
  value,
  context,
  title,
  tone,
}: {
  label: string
  value: string
  context?: ReactNode
  title?: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3" title={title}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-0.5 truncate text-lg font-semibold tracking-tight',
          tone === 'warning' && 'text-chart-yellow'
        )}
      >
        {value}
      </div>
      {context ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {context}
        </div>
      ) : null}
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  )
}

/** Key/value definition row for long metadata (keys, sources, SQL). */
function MetaRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <div className="w-40 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'min-w-0 break-words text-[13px]',
          mono && 'font-mono text-xs'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-full rounded-lg" />
      {[0, 1].map((section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function OverviewTab() {
  const hostId = useHostId()
  const { database, table } = useExplorerState()

  const params =
    database && table
      ? `hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null
  const summaryUrl = params
    ? `/api/v1/tables/explorer-table-overview?${params}`
    : null

  const {
    data: summaryResponse,
    error: summaryError,
    isLoading: summaryLoading,
  } = useQuery<ApiResponse<OverviewRow[]>>({
    queryKey: [summaryUrl],
    queryFn: () => fetcher<OverviewRow[]>(summaryUrl!),
    enabled: Boolean(summaryUrl),
  })

  const summary = summaryResponse?.data?.[0]
  const kind = classifyEngine(summary?.engine)
  const isDictionary = kind === 'dictionary'
  const isViewLike = kind === 'view' || kind === 'materialized-view'

  // Engine-aware follow-up queries: only fetch what this object type has.
  const dictionaryUrl =
    params && isDictionary
      ? `/api/v1/tables/explorer-dictionary-overview?${params}`
      : null
  const usageUrl =
    params && !isViewLike
      ? `/api/v1/tables/explorer-table-usage?${params}`
      : null

  const { data: dictionaryResponse, isLoading: dictionaryLoading } = useQuery<
    ApiResponse<DictionaryRow[]>
  >({
    queryKey: [dictionaryUrl],
    queryFn: () => fetcher<DictionaryRow[]>(dictionaryUrl!),
    enabled: Boolean(dictionaryUrl),
  })

  const {
    data: usageResponse,
    error: usageError,
    isLoading: usageLoading,
  } = useQuery<ApiResponse<UsageRow[]>>({
    queryKey: [usageUrl],
    queryFn: () => fetcher<UsageRow[]>(usageUrl!),
    enabled: Boolean(usageUrl),
  })

  if (!database || !table) {
    return null
  }

  if (summaryLoading) {
    return <OverviewSkeleton />
  }

  if (summaryError) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-destructive">
        Failed to load overview: {getErrorMessage(summaryError)}
      </div>
    )
  }

  const dictionary = dictionaryResponse?.data?.[0]
  const usage = usageResponse?.data?.[0]
  const usageUnavailable =
    Boolean(usageError) ||
    usageResponse?.metadata?.unavailable === true ||
    (!usageLoading && !usage)

  const lastModified = formatTimestamp(
    summary?.last_modified || summary?.metadata_modification_time
  )
  const metadataChanged = formatTimestamp(summary?.metadata_modification_time)
  const showStorage = hasPartStorage(kind)
  const mvTarget = parseMaterializedViewTarget(summary?.create_table_query)
  const definition = summary?.as_select?.trim() || ''

  return (
    <div className="space-y-5">
      {/* Identity strip — what this object actually is */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2.5">
        <Database
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="text-sm font-medium">{engineKindLabel(kind)}</span>
        <span className="text-muted-foreground">·</span>
        <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {summary?.engine_full || summary?.engine || 'Unknown engine'}
        </code>
      </div>

      {showStorage ? (
        <Section icon={HardDrive} title="Storage">
          <StatTile
            label="Table size"
            value={formatBytes(summary?.total_bytes)}
            context={`${formatNumber(summary?.total_rows)} rows`}
          />
          <StatTile
            label="Compression"
            value={formatCompressionRatio(
              summary?.compressed_bytes,
              summary?.uncompressed_bytes
            )}
            context={`${formatBytes(summary?.compressed_bytes)} of ${formatBytes(summary?.uncompressed_bytes)}`}
          />
          <StatTile
            label="Parts"
            value={formatNumber(summary?.active_parts)}
            context={`${formatNumber(summary?.partitions)} partitions`}
          />
          <StatTile
            label="Index in memory"
            value={formatBytes(summary?.primary_key_bytes_in_memory)}
            context={`${formatBytes(summary?.primary_key_bytes_in_memory_allocated)} allocated`}
          />
        </Section>
      ) : null}

      {isDictionary ? (
        <>
          {dictionary?.last_exception ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 break-words">
                <div className="font-medium text-destructive">Load failed</div>
                <div className="mt-0.5 text-muted-foreground">
                  {dictionary.last_exception}
                </div>
              </div>
            </div>
          ) : null}
          <Section icon={Boxes} title="Dictionary">
            <StatTile
              label="Status"
              value={
                dictionaryLoading
                  ? '…'
                  : dictionary?.status?.replace(/_/g, ' ') || 'Unknown'
              }
              context={dictionary?.type || undefined}
              tone={
                dictionary?.status && dictionary.status !== 'LOADED'
                  ? 'warning'
                  : 'default'
              }
            />
            <StatTile
              label="Elements"
              value={formatNumber(dictionary?.element_count)}
              context={
                toFiniteNumber(dictionary?.load_factor) === null
                  ? undefined
                  : `load factor ${Number(dictionary?.load_factor).toFixed(2)}`
              }
            />
            <StatTile
              label="Memory"
              value={formatBytes(dictionary?.bytes_allocated)}
            />
            <StatTile
              label="Load time"
              value={formatSeconds(dictionary?.loading_duration)}
              context={
                formatTimestamp(dictionary?.last_successful_update_time)
                  .relative === 'never'
                  ? 'never updated'
                  : `updated ${formatTimestamp(dictionary?.last_successful_update_time).relative}`
              }
              title={
                formatTimestamp(dictionary?.last_successful_update_time)
                  .absolute ?? undefined
              }
            />
          </Section>
        </>
      ) : null}

      <Section icon={Activity} title="Activity">
        {showStorage ? (
          <StatTile
            label="Last modified"
            value={lastModified.relative}
            context={lastModified.absolute ?? 'no active parts'}
            title={lastModified.absolute ?? undefined}
          />
        ) : (
          <StatTile
            label="Metadata changed"
            value={metadataChanged.relative}
            context={metadataChanged.absolute ?? undefined}
            title={metadataChanged.absolute ?? undefined}
          />
        )}
        {isViewLike ? null : (
          <>
            <StatTile
              label="Queries (24h)"
              value={
                usageLoading
                  ? '…'
                  : usageUnavailable
                    ? EM_DASH
                    : formatNumber(usage?.queries_24h)
              }
              context={
                usageUnavailable && !usageLoading
                  ? 'system.query_log unavailable'
                  : undefined
              }
            />
            <StatTile
              label="Queries (7d)"
              value={
                usageLoading
                  ? '…'
                  : usageUnavailable
                    ? EM_DASH
                    : formatNumber(usage?.queries_7d)
              }
            />
          </>
        )}
        {isDictionary && dictionary ? (
          <StatTile
            label="Lifetime"
            value={
              toFiniteNumber(dictionary.lifetime_max) === null
                ? EM_DASH
                : `${formatNumber(dictionary.lifetime_min)}–${formatNumber(dictionary.lifetime_max)}s`
            }
            context="refresh window"
          />
        ) : null}
      </Section>

      <Section icon={Info} title="Metadata">
        <div className="sm:col-span-2 lg:col-span-4 rounded-lg border bg-card px-3 py-1">
          {showStorage ? (
            <>
              <MetaRow
                label="Sorting key"
                value={summary?.sorting_key || EM_DASH}
                mono
              />
              <MetaRow
                label="Partition key"
                value={summary?.partition_key || 'none'}
                mono
              />
              <MetaRow
                label="Primary key"
                value={summary?.primary_key || EM_DASH}
                mono
              />
            </>
          ) : null}
          {isDictionary && dictionary ? (
            <>
              <MetaRow
                label="Key"
                value={dictionary.key_names?.join(', ') || EM_DASH}
                mono
              />
              <MetaRow
                label="Attributes"
                value={dictionary.attribute_names?.join(', ') || 'none'}
                mono
              />
              <MetaRow label="Source" value={dictionary.source || EM_DASH} />
            </>
          ) : null}
          {kind === 'materialized-view' ? (
            <MetaRow label="Target table" value={mvTarget || 'inner table'} />
          ) : null}
          {!showStorage && !isDictionary && !isViewLike ? (
            <MetaRow
              label="Engine"
              value={summary?.engine_full || summary?.engine || EM_DASH}
              mono
            />
          ) : null}
        </div>
      </Section>

      {isViewLike && definition ? (
        <Section icon={FileCode2} title="Definition">
          <pre className="sm:col-span-2 lg:col-span-4 max-h-64 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs">
            {definition}
          </pre>
        </Section>
      ) : null}

      {!showStorage && !isDictionary && !isViewLike ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" strokeWidth={1.5} />
          This engine does not expose part-level storage statistics.
        </p>
      ) : null}

      {!isViewLike && !isDictionary ? (
        <ExplorerTuningSection
          database={database}
          table={table}
          engine={summary?.engine}
          engineFull={summary?.engine_full}
        />
      ) : null}
    </div>
  )
}
