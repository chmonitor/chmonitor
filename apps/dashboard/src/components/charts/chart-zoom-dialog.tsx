import {
  Check,
  Clock,
  Copy,
  Database,
  ExternalLink,
  GripHorizontal,
  Hash,
  Maximize2Icon,
  Server,
  SparklesIcon,
  Zap,
} from 'lucide-react'

import type { CardToolbarMetadata } from '@/components/cards/card-toolbar'
import type { DateRangeConfig, DateRangeValue } from '@/components/date-range'
import type { StaleError } from '@/lib/swr'
import type { ChartDataPoint } from '@/types/chart-data'
import type { QueryConfig } from '@/types/query-config'

import { useEffect, useRef, useState } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { ChartStaleIndicator } from '@/components/charts/chart-stale-indicator'
import { DataTable } from '@/components/data-table/data-table'
import { DateRangeSelector } from '@/components/date-range'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatSql } from '@/lib/sql-format'
import { cn, dedent } from '@/lib/utils'

const BEAUTIFY_STORAGE_KEY = 'chart-zoom-sql-beautify'

// Stable empty context object — avoids new reference on every render which
// would defeat column-def memoization inside DataTable.
const EMPTY_TABLE_CONTEXT: Record<string, string> = {}

function getInitialBeautifyState(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(BEAUTIFY_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function CopyableValue({
  value,
  className = '',
}: {
  value: string | number
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(String(value))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'font-mono font-medium text-right truncate min-w-0 hover:text-primary cursor-pointer transition-colors inline-flex items-center gap-1 group/copy max-w-full',
              className
            )}
          />
        }
      >
        <span className="truncate flex-1 min-w-0">{value}</span>
        {copied ? (
          <Check className="size-3 text-green-500 shrink-0" strokeWidth={2} />
        ) : (
          <Copy
            className="size-3 opacity-30 group-hover/copy:opacity-100 shrink-0 transition-opacity"
            strokeWidth={1.5}
          />
        )}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        className="max-w-[95vw] break-all font-mono text-xs"
      >
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

export interface ChartZoomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  sql?: string
  data?: ChartDataPoint[]
  metadata?: CardToolbarMetadata
  children: React.ReactNode
  dateRangeConfig?: DateRangeConfig
  currentRange?: string
  onRangeChange?: (range: DateRangeValue) => void
  staleError?: StaleError
  onRetry?: () => Promise<unknown>
  className?: string
}

export const ChartZoomDialog = function ChartZoomDialog({
  open,
  onOpenChange,
  title,
  sql,
  data,
  metadata,
  children,
  dateRangeConfig,
  currentRange,
  onRangeChange,
  staleError,
  onRetry,
  className: _className,
}: ChartZoomDialogProps) {
  const [activeTab, setActiveTab] = useState<'chart' | 'data' | 'query'>(
    'chart'
  )
  const [isBeautified, setIsBeautified] = useState(getInitialBeautifyState)
  const [queryCopied, setQueryCopied] = useState(false)
  const [dialogHeight, setDialogHeight] = useState<string | undefined>('85vh')
  const contentRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef<{
    startY: number
    startHeight: number
  } | null>(null)

  const handleBeautifyToggle = (checked: boolean) => {
    setIsBeautified(checked)
    try {
      localStorage.setItem(BEAUTIFY_STORAGE_KEY, String(checked))
    } catch {
      // Ignore storage errors
    }
  }

  const handleQueryCopy = async () => {
    if (!sql) return
    const text = isBeautified ? await formatSql(sql) : dedent(sql)
    await navigator.clipboard.writeText(text)
    setQueryCopied(true)
    setTimeout(() => setQueryCopied(false), 2000)
  }

  // Handle dialog resize via mouse drag
  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = contentRef.current
    if (!el) return
    resizeStartRef.current = {
      startY: e.clientY,
      startHeight: el.offsetHeight,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStartRef.current) return
      const { startY, startHeight } = resizeStartRef.current
      const delta = moveEvent.clientY - startY
      const newHeight = Math.max(400, startHeight + delta)
      setDialogHeight(`${newHeight}px`)
    }

    const handleMouseUp = () => {
      resizeStartRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Memoize QueryConfig for DataTable
  const queryConfig = ((): QueryConfig<string[]> | undefined => {
    if (!data || data.length === 0) return undefined
    return {
      name: 'chart-data',
      description: title ?? 'Chart data',
      sql: sql ?? 'SELECT * FROM chart_data',
      columns: Object.keys(data[0]) as string[],
    }
  })()

  // Build full API URL
  const fullApiUrl = (() => {
    if (!metadata?.api) return null
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    return metadata.api.startsWith('http')
      ? metadata.api
      : `${baseUrl}${metadata.api}`
  })()

  // Check if we have metadata to show
  const hasMetadata =
    metadata &&
    (metadata.duration !== undefined ||
      metadata.rows !== undefined ||
      metadata.clickhouseVersion ||
      metadata.host ||
      metadata.queryId ||
      metadata.api)

  // Raw (dedented) SQL is shown immediately; when beautify is on we swap in the
  // lazily-formatted version once the formatter chunk loads and resolves. This
  // keeps the displayed query stable (no flashing to empty) while the import
  // happens, and formatSql falls back to raw SQL on any error.
  const rawSQL = sql ? dedent(sql) : ''
  const [displaySQL, setDisplaySQL] = useState(rawSQL)

  useEffect(() => {
    if (!sql) {
      setDisplaySQL('')
      return
    }
    if (!isBeautified) {
      setDisplaySQL(dedent(sql))
      return
    }
    let cancelled = false
    formatSql(sql).then((formatted) => {
      if (!cancelled) setDisplaySQL(formatted)
    })
    return () => {
      cancelled = true
    }
  }, [sql, isBeautified])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="w-[80vw] max-w-[80vw] sm:max-w-[80vw] flex flex-col p-0 pb-6"
        style={{ height: dialogHeight, maxHeight: '95vh' }}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="truncate flex-1">{title}</DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              {staleError && onRetry && (
                <ChartStaleIndicator error={staleError} onRetry={onRetry} />
              )}
              {dateRangeConfig && onRangeChange && (
                <DateRangeSelector
                  config={dateRangeConfig}
                  value={currentRange ?? dateRangeConfig.defaultValue}
                  onChange={onRangeChange}
                />
              )}
            </div>
          </div>
          {hasMetadata && (
            <div className="rounded-lg border border-border/50 p-3 mt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {fullApiUrl && (
                  <div className="col-span-2 flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <ExternalLink className="size-3" strokeWidth={1.5} />
                      API
                    </dt>
                    <dd className="min-w-0 flex-1 text-right">
                      <CopyableValue value={fullApiUrl} />
                    </dd>
                  </div>
                )}
                {metadata?.duration !== undefined && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Clock className="size-3" strokeWidth={1.5} />
                      Duration
                    </dt>
                    <CopyableValue value={`${metadata.duration}ms`} />
                  </div>
                )}
                {metadata?.rows !== undefined && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Database className="size-3" strokeWidth={1.5} />
                      Rows
                    </dt>
                    <CopyableValue value={metadata.rows.toLocaleString()} />
                  </div>
                )}
                {metadata?.clickhouseVersion && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Zap className="size-3" strokeWidth={1.5} />
                      Version
                    </dt>
                    <CopyableValue value={metadata.clickhouseVersion} />
                  </div>
                )}
                {metadata?.host && (
                  <div className="col-span-2 flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Server className="size-3" strokeWidth={1.5} />
                      Host
                    </dt>
                    <CopyableValue value={metadata.host} />
                  </div>
                )}
                {metadata?.queryId && (
                  <div className="col-span-2 flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Hash className="size-3" strokeWidth={1.5} />
                      Query ID
                    </dt>
                    <CopyableValue value={metadata.queryId} />
                  </div>
                )}
              </dl>
            </div>
          )}
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div className="px-6 pt-2 flex items-center justify-between">
            <TabsList className="h-8">
              <TabsTrigger value="chart" className="text-xs h-7">
                Chart
              </TabsTrigger>
              {queryConfig && (
                <TabsTrigger value="data" className="text-xs h-7">
                  Data
                </TabsTrigger>
              )}
              {sql && (
                <TabsTrigger value="query" className="text-xs h-7">
                  Query
                </TabsTrigger>
              )}
            </TabsList>
            {activeTab === 'query' && sql && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <SparklesIcon className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Beautify
                  </span>
                  <Switch
                    checked={isBeautified}
                    onCheckedChange={handleBeautifyToggle}
                    aria-label="Toggle SQL beautification"
                    className="scale-75"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs text-muted-foreground px-2"
                  onClick={handleQueryCopy}
                >
                  {queryCopied ? (
                    <Check className="size-3" strokeWidth={1.5} />
                  ) : (
                    <Copy className="size-3" strokeWidth={1.5} />
                  )}
                  {queryCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </div>

          <TabsContent
            value="chart"
            className="flex-1 min-h-0 p-6 flex flex-col"
          >
            <div className="w-full flex-1 min-h-[350px] relative h-full">
              <div className="absolute inset-0">{children}</div>
            </div>
          </TabsContent>

          {queryConfig && (
            <TabsContent
              value="data"
              className="flex-1 min-h-0 p-6 overflow-auto"
            >
              <DataTable
                data={data as Record<string, unknown>[]}
                queryConfig={queryConfig}
                context={EMPTY_TABLE_CONTEXT}
                defaultPageSize={50}
                showSQL={false}
                enableColumnFilters={true}
                enableColumnReordering={false}
              />
            </TabsContent>
          )}

          {sql && (
            <TabsContent
              value="query"
              className="flex-1 min-h-0 p-6 overflow-auto"
            >
              <CodeBlock
                code={displaySQL}
                language="sql"
                className="[&_pre]:whitespace-pre-wrap [&_pre]:break-words"
              >
                <CodeBlockCopyButton />
              </CodeBlock>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2">
                <span>ClickHouse SQL Dialect</span>
                <span>{displaySQL.split('\n').length} lines</span>
              </div>
            </TabsContent>
          )}
        </Tabs>
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 left-0 right-0 h-5 cursor-s-resize flex items-center justify-center opacity-0 hover:opacity-60 transition-opacity group"
        >
          <GripHorizontal className="size-3.5 text-muted-foreground" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export interface ChartZoomButtonProps {
  onClick: () => void
  disabled?: boolean
}

export const ChartZoomButton = function ChartZoomButton({
  onClick,
  disabled = false,
}: ChartZoomButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            disabled={disabled}
            aria-label="Zoom chart"
            className={cn(
              'size-6 rounded-full transition-opacity',
              'relative before:content-[""] before:absolute before:-inset-4',
              'opacity-0 group-hover:opacity-40 hover:!opacity-100'
            )}
          />
        }
      >
        <Maximize2Icon className="size-3.5" strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Zoom to
      </TooltipContent>
    </Tooltip>
  )
}
