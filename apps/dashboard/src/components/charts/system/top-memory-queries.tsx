'use client'

import { ExternalLink, Lightbulb, MemoryStick } from 'lucide-react'

import type { ChartProps } from '@/components/charts/chart-props'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { REFRESH_INTERVAL, useChartData, useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

type DataRow = {
  normalized_query_hash: string
  query_preview: string
  /** Full query text (the row list still shows the truncated preview). */
  full_query?: string
  execution_count: number
  peak_memory: number
  readable_peak_memory: string
  avg_memory: number
  readable_avg_memory: string
}

// ──────────────────────────── Detail dialog ────────────────────────────

interface QueryDetailDialogProps {
  row: DataRow | null
  hostId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

function QueryDetailDialog({
  row,
  hostId,
  open,
  onOpenChange,
}: QueryDetailDialogProps) {
  const [copied, setCopied] = useState(false)

  if (!row) return null

  // Prefer the full query for the dialog + Explorer/Explain links; fall back to
  // the truncated preview only when the full text isn't available.
  const query = row.full_query || row.query_preview
  const explorerUrl = buildExplorerQueryUrl(query, hostId)
  const explainUrl = `/explain?query=${encodeURIComponent(query)}&host=${hostId}`

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText)
      return
    try {
      await navigator.clipboard.writeText(query)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* noop */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MemoryStick className="size-4 text-orange-500" />
            Memory Query Detail
          </DialogTitle>
        </DialogHeader>

        {/* Metrics strip */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Peak Memory
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-orange-600 dark:text-orange-400">
              {row.readable_peak_memory}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Avg Memory
            </span>
            <span className="font-mono text-sm font-medium tabular-nums">
              {row.readable_avg_memory}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Executions
            </span>
            <span className="font-mono text-sm font-medium tabular-nums">
              {row.execution_count.toLocaleString()}
            </span>
          </div>
        </div>

        {/* SQL block */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              SQL Preview
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              (first 120 chars)
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-[11px] text-muted-foreground"
              onClick={handleCopy}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-relaxed text-foreground">
            {query}
          </pre>
        </div>

        {/* Action footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            render={<Link href={explorerUrl} />}
          >
            <ExternalLink className="size-3.5" />
            Open in Explorer
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            render={<Link href={explainUrl} />}
          >
            <Lightbulb className="size-3.5" />
            Explain
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────── Row item ────────────────────────────

interface MemoryQueryRowProps {
  row: DataRow
  maxMemory: number
  index: number
  total: number
  onClick: (row: DataRow) => void
}

function MemoryQueryRow({
  row,
  maxMemory,
  index,
  total,
  onClick,
}: MemoryQueryRowProps) {
  const percentage = maxMemory > 0 ? (row.peak_memory / maxMemory) * 100 : 0
  // Opacity fades from full to 55% across the list
  const opacity = Math.round(100 - (index / Math.max(total - 1, 1)) * 45)
  const barColor = `color-mix(in oklch, var(--chart-1) ${opacity}%, transparent)`

  return (
    <button
      type="button"
      className={cn(
        'group relative w-full overflow-hidden rounded text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'hover:bg-muted/30'
      )}
      onClick={() => onClick(row)}
      aria-label={`View details for query: ${row.query_preview}`}
    >
      {/* Bar track (sits behind everything) */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded opacity-40 transition-opacity group-hover:opacity-30"
        aria-hidden="true"
        style={{
          width: `${percentage}%`,
          backgroundColor: barColor,
        }}
      />

      {/* Content row */}
      <div className="relative flex h-8 items-center justify-between gap-2 px-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
          {row.query_preview}
        </span>
        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-orange-600 dark:text-orange-400">
          {row.readable_peak_memory}
        </span>
      </div>
    </button>
  )
}

// ──────────────────────────── Main component ────────────────────────────

export const ChartTopMemoryQueries = function ChartTopMemoryQueries({
  title,
  className,
  chartCardContentClassName,
  hostId: hostIdProp,
}: ChartProps) {
  const routeHostId = useHostId()
  const hostId = hostIdProp ?? routeHostId

  const swr = useChartData<DataRow>({
    chartName: 'top-memory-queries',
    hostId,
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
  })

  const [selectedRow, setSelectedRow] = useState<DataRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleRowClick = (row: DataRow) => {
    setSelectedRow(row)
    setDialogOpen(true)
  }

  return (
    <>
      <ChartContainer swr={swr} title={title} className={className}>
        {(dataArray, sql, metadata, staleError, mutate) => {
          const rows = dataArray as DataRow[]
          const maxMemory = Math.max(...rows.map((r) => r.peak_memory), 1)

          return (
            <ChartCard
              title={title}
              className={className}
              sql={sql}
              data={rows}
              metadata={metadata}
              data-testid="top-memory-queries-chart"
              staleError={staleError}
              onRetry={mutate}
              contentClassName={chartCardContentClassName}
            >
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex flex-col gap-0.5 py-1">
                  {rows.map((row, index) => (
                    <MemoryQueryRow
                      key={row.normalized_query_hash || row.query_preview}
                      row={row}
                      maxMemory={maxMemory}
                      index={index}
                      total={rows.length}
                      onClick={handleRowClick}
                    />
                  ))}
                </div>
              </div>
            </ChartCard>
          )
        }}
      </ChartContainer>

      <QueryDetailDialog
        row={selectedRow}
        hostId={hostId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  )
}

export default ChartTopMemoryQueries
