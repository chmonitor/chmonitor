import {
  Code2Icon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveDownloadIcon,
  MemoryStickIcon,
  TimerIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'

import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

/**
 * Client-only implementation of the query-metric-log row-expand panel.
 *
 * This module uses hooks (`useHostId`, `useQuery`) and must NEVER be pulled
 * into the server/Worker bundle that eagerly imports the query-config registry.
 * It is loaded exclusively via `React.lazy` from
 * `create-query-metric-log-expanded-details.tsx`, so it only ever evaluates in
 * the browser when a user expands a row.
 *
 * `system.query_metric_log` samples per-query resource usage but carries no SQL
 * text. On expand we look the query up by `query_id` in `system.query_log`
 * (most-recent row) through the existing `/api/v1/explorer/query-log` endpoint
 * to reveal the actual SQL plus the read/written/result counters the metric
 * samples don't capture. query_log flushes asynchronously, so a `null` row means
 * "not flushed yet" and we poll briefly until it appears.
 */

type QueryLogRow = Record<string, unknown> & {
  query?: string
  query_kind?: string
  query_duration_ms?: number
  read_rows?: number
  read_bytes?: number
  written_rows?: number
  written_bytes?: number
  result_rows?: number
  result_bytes?: number
  memory_usage?: number
  exception?: string
  databases?: string[]
  tables?: string[]
}

interface Props {
  row: Record<string, unknown>
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function toStringSafe(value: unknown): string {
  return hasValue(value) ? String(value) : ''
}

function toNumberOrNull(value: unknown): number | null {
  if (!hasValue(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Prefer a precomputed `readable_<key>` companion, else format the raw value. */
function readable(
  row: Record<string, unknown>,
  key: string,
  format: (n: number) => string
): string {
  const pre = toStringSafe(row[`readable_${key}`])
  if (pre) return pre
  const raw = toNumberOrNull(row[key])
  return raw === null ? '' : format(raw)
}

/** Humanize a microsecond duration as "s / ms / us". */
function formatMicros(us: number | null): string {
  if (us === null) return ''
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)} s`
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)} ms`
  return `${us} us`
}

function StatTile({
  label,
  value,
  icon: Icon,
  mono = false,
}: {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
  mono?: boolean
}) {
  if (!value) return null
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 truncate text-sm font-semibold leading-none tabular-nums text-foreground',
          mono && 'font-mono'
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

export default function QueryMetricLogExpandedDetails({ row }: Props) {
  const hostId = useHostId()
  const queryId = toStringSafe(row.query_id)

  // The lookup endpoint only serves env-configured hosts (hostId >= 0). Browser
  // / per-user connections (negative hostId) aren't reachable here yet, so we
  // skip the fetch and show a clear note instead of surfacing a raw 400.
  const supported = hostId >= 0

  const { data, isLoading, isError, error } = useQuery<
    QueryLogRow | null,
    Error
  >({
    queryKey: ['query-metric-log:query-log', hostId, queryId],
    enabled: supported && Boolean(queryId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    // query_log is flushed asynchronously; poll until the row shows up.
    refetchInterval: (q) => (q.state.data ? false : 3_000),
    queryFn: async () => {
      const params = new URLSearchParams({
        hostId: String(hostId),
        queryId,
      })
      const res = await apiFetch(
        `/api/v1/explorer/query-log?${params.toString()}`
      )
      const json = (await res.json()) as ApiResponse<QueryLogRow | null>
      if (!json.success) {
        throw new Error(json.error?.message ?? 'Failed to load query')
      }
      return json.data ?? null
    },
  })

  // ── Metric sample tiles (already in the row) ──────────────────────────────
  const sampleTiles = (
    <div>
      <SectionTitle>Resource sample</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          icon={MemoryStickIcon}
          label="Memory"
          value={readable(row, 'memory', formatReadableSize)}
        />
        <StatTile
          icon={GaugeIcon}
          label="Peak memory"
          value={readable(row, 'peak_memory', formatReadableSize)}
        />
        <StatTile
          icon={CpuIcon}
          label="CPU time"
          value={
            toStringSafe(row.readable_cpu_time) ||
            formatMicros(toNumberOrNull(row.cpu_time))
          }
        />
        <StatTile
          icon={TimerIcon}
          label="Wall time"
          value={
            toStringSafe(row.readable_real_time) ||
            formatMicros(toNumberOrNull(row.real_time))
          }
        />
        <StatTile
          icon={HardDriveDownloadIcon}
          label="Selected rows"
          value={readable(row, 'selected_rows', (n) =>
            formatReadableQuantity(n)
          )}
        />
      </div>
    </div>
  )

  // ── query_log enrichment tiles (fetched) ──────────────────────────────────
  const logTiles = (() => {
    if (!data) return null
    const tiles = [
      {
        label: 'Duration',
        value:
          data.query_duration_ms != null
            ? `${(Number(data.query_duration_ms) / 1000).toFixed(2)} s`
            : '',
        icon: TimerIcon,
      },
      {
        label: 'Read rows',
        value:
          data.read_rows != null
            ? formatReadableQuantity(Number(data.read_rows))
            : '',
        icon: HardDriveDownloadIcon,
      },
      {
        label: 'Read bytes',
        value:
          data.read_bytes != null
            ? formatReadableSize(Number(data.read_bytes))
            : '',
        icon: HardDriveDownloadIcon,
      },
      {
        label: 'Written rows',
        value:
          data.written_rows != null
            ? formatReadableQuantity(Number(data.written_rows))
            : '',
        icon: DatabaseIcon,
      },
      {
        label: 'Written bytes',
        value:
          data.written_bytes != null
            ? formatReadableSize(Number(data.written_bytes))
            : '',
        icon: DatabaseIcon,
      },
      {
        label: 'Result rows',
        value:
          data.result_rows != null
            ? formatReadableQuantity(Number(data.result_rows))
            : '',
        icon: HardDriveDownloadIcon,
      },
    ].filter((t) => t.value)

    if (tiles.length === 0) return null
    return (
      <div>
        <SectionTitle>Query log</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => (
            <StatTile
              key={t.label}
              icon={t.icon}
              label={t.label}
              value={t.value}
            />
          ))}
        </div>
      </div>
    )
  })()

  // ── SQL section ───────────────────────────────────────────────────────────
  const sql = toStringSafe(data?.query)
  const kind = toStringSafe(data?.query_kind)
  const exception = toStringSafe(data?.exception)

  const sqlSection = (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Code2Icon className="size-3 shrink-0" aria-hidden="true" />
          Query
          {kind && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] uppercase text-muted-foreground">
              {kind}
            </span>
          )}
        </span>
        {sql && (
          <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
            {sql.length.toLocaleString()} chars
          </span>
        )}
      </div>

      {!supported ? (
        <p className="text-xs text-muted-foreground">
          SQL lookup isn't available for browser / per-user connections yet.
        </p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Loading query…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">
          {error?.message ?? 'Failed to load query.'}
        </p>
      ) : sql ? (
        <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
          {sql}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">
          No query text found for this query_id yet — query_log is flushed
          asynchronously, so it may appear shortly.
        </p>
      )}

      {exception && (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {exception}
        </p>
      )}
    </div>
  )

  return (
    <div data-slot="query-metric-log-expanded" className="space-y-3.5">
      {sampleTiles}
      {logTiles}
      {sqlSection}
    </div>
  )
}
