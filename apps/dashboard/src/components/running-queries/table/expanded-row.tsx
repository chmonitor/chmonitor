import {
  CircleX,
  ExternalLink,
  Loader2,
  ScanSearch,
  Workflow,
  X,
} from 'lucide-react'

import type { DerivedQuery } from './types'

import { DetailField } from '@/components/query-tables/detail-field'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatReadableSize } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'

interface ExpandedRowProps {
  d: DerivedQuery
  onKill: () => void
  isKilling: boolean
  /** Row has finished and is being retained; swaps Kill → Dismiss. */
  done?: boolean
  /** Drop this retained Done row from the table. */
  onDismiss?: () => void
}

/**
 * Expanded row — an execution-details grid, the full query as a scrollable
 * code block, then row actions.
 */
export function ExpandedRow({
  d,
  onKill,
  isKilling,
  done,
  onDismiss,
}: ExpandedRowProps) {
  const hostId = useHostId()
  const explorerUrl = buildExplorerQueryUrl(d.query, hostId)
  const detailUrl = d.id
    ? `/query?query_id=${encodeURIComponent(d.id)}&host=${hostId}`
    : ''
  const explainUrl = d.id
    ? buildUrl('/explain', { query_id: d.id, host: hostId })
    : ''
  const lineCount = (d.query.match(/\n/g)?.length ?? 0) + 1

  // Every field is backed by a real `system.processes` column.
  const fields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: 'Query ID', value: d.id },
    { label: 'User', value: d.user, mono: false },
    { label: 'Database', value: d.db },
    { label: 'Interface', value: d.iface ?? '—', mono: false },
    {
      label: 'Address',
      value: d.row.address
        ? `${d.row.address}${d.row.port ? `:${d.row.port}` : ''}`
        : '—',
    },
    {
      label: 'Depth',
      value:
        d.row.distributed_depth != null ? String(d.row.distributed_depth) : '0',
    },
    { label: 'Duration', value: d.readableElapsed, mono: false },
    { label: 'Memory', value: d.readableMemory },
    { label: 'Rows read', value: d.readableReadRows },
    { label: 'Data read', value: formatReadableSize(d.readBytes) },
  ]

  return (
    <div className="space-y-3 border-t border-border bg-muted/40 px-3 py-3.5 sm:px-5">
      {/* Execution details — a compact key/value grid */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Execution details
        </div>
        <dl className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {fields.map((f) => (
            <DetailField
              key={f.label}
              label={f.label}
              value={f.value}
              mono={f.mono}
            />
          ))}
        </dl>
      </div>

      {/* Full query — a plain, scrollable code block. Not wrapped in a
          button: the SQL is selectable text; "Open in Explorer" below is the
          interactive path. */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Full query
          </span>
          <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
            {d.query.length.toLocaleString()} chars
            <span className="mx-1.5 opacity-50">·</span>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
          {d.query}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 gap-1.5" asChild>
          <Link href={explorerUrl}>
            <ExternalLink className="size-3.5" />
            Open in Explorer
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          asChild={Boolean(detailUrl)}
          disabled={!detailUrl}
        >
          {detailUrl ? (
            <Link href={detailUrl}>
              <ScanSearch className="size-3.5" />
              Query detail
            </Link>
          ) : (
            <span className="inline-flex h-7 items-center gap-1.5">
              <ScanSearch className="size-3.5" />
              Query detail
            </span>
          )}
        </Button>
        {explainUrl && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5" asChild>
            <Link href={explainUrl}>
              <Workflow className="size-3.5" />
              Explain
            </Link>
          </Button>
        )}
        {done ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
            Dismiss
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
            onClick={onKill}
            disabled={isKilling || !d.id}
          >
            {isKilling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CircleX className="size-3.5" />
            )}
            Kill query
          </Button>
        )}
      </div>
    </div>
  )
}
