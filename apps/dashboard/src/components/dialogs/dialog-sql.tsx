import {
  Check,
  Clock,
  CodeIcon,
  Copy,
  Database,
  ExternalLink,
  Hash,
  Info,
  SparklesIcon,
  Zap,
} from 'lucide-react'

import type { ApiResponseMetadata } from '@/lib/api/types'

import { useEffect, useMemo, useState } from 'react'
import { highlightCode } from '@/components/ai-elements/code-block'
import { HLJS_TOKEN_CLASSES } from '@/components/ai-elements/hljs-token-classes'
import {
  DialogContent,
  type DialogContentProps,
} from '@/components/dialogs/dialog-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatSql } from '@/lib/sql-format'
import { cn, dedent, formatDuration } from '@/lib/utils'

interface ShowSQLButtonProps extends Omit<DialogContentProps, 'content'> {
  sql?: string
  /** Enable full-screen mode */
  fullScreen?: boolean
  /** Query execution metadata */
  metadata?: Partial<ApiResponseMetadata>
  /** Default beautify state when the user has no stored preference */
  defaultBeautify?: boolean
}

const STORAGE_KEY = 'sql-beautify'

/**
 * Get initial beautify state. A stored user preference always wins; otherwise
 * fall back to `fallback` (defaults to off).
 */
function getInitialBeautifyState(fallback = false): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === null) return fallback
    return value === 'true'
  } catch {
    return fallback
  }
}

/** Save beautify state to localStorage */
function saveBeautifyState(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // Ignore storage errors
  }
}

/** Copyable value component */
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
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'font-mono font-medium text-right truncate min-w-0 hover:text-primary cursor-pointer transition-colors inline-flex items-center gap-1 group/copy',
        className
      )}
      title={`Click to copy: ${value}`}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 text-green-500 shrink-0" strokeWidth={2} />
      ) : (
        <Copy
          className="size-3 opacity-0 group-hover/copy:opacity-50 shrink-0 transition-opacity"
          strokeWidth={1.5}
        />
      )}
    </button>
  )
}

/**
 * Shared Request Info body: query metadata grid + syntax-highlighted SQL.
 *
 * Rendered both by {@link DialogSQL} (inside the shared DialogContent wrapper)
 * and by `CardToolbar` (inside its controlled Dialog) so the two "Request Info"
 * dialogs stay identical.
 */
export function RequestInfoContent({
  sql,
  metadata,
  fullScreen = true,
  defaultBeautify = false,
}: {
  sql?: string
  metadata?: Partial<ApiResponseMetadata>
  fullScreen?: boolean
  defaultBeautify?: boolean
}) {
  const [isBeautified, setIsBeautified] = useState(() =>
    getInitialBeautifyState(defaultBeautify)
  )
  const [copied, setCopied] = useState(false)

  const handleBeautifyToggle = (checked: boolean) => {
    setIsBeautified(checked)
    saveBeautifyState(checked)
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Build full API URL for debugging
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

  // Show raw (dedented) SQL right away; when beautify is on, swap in the
  // lazily-formatted result once the sql-formatter chunk loads. Keeps the
  // displayed query stable (no flash) and falls back to raw SQL on error.
  const [displaySQL, setDisplaySQL] = useState(sql ? dedent(sql) : '')

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

  const highlightedHtml = useMemo(() => {
    if (!displaySQL) return ''
    return highlightCode(displaySQL, 'sql')
  }, [displaySQL])

  return (
    <div className="flex flex-col gap-3">
      {/* Metadata Section */}
      {hasMetadata && (
        <div className="rounded-xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/20 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Info className="size-3.5 text-primary" strokeWidth={2} />
              Request Info
            </h3>
            <Badge
              variant="outline"
              className="font-mono text-[10px] bg-background/50 border-border/40"
            >
              {metadata?.host || 'Local'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {fullApiUrl && (
              <div className="col-span-full group/api">
                <dt className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight mb-1 flex items-center gap-1.5">
                  <ExternalLink className="size-3" strokeWidth={1.5} />
                  API Endpoint
                </dt>
                <dd className="flex items-center gap-2 bg-background/50 rounded-md border border-border/40 px-2 py-1.5 transition-colors group-hover/api:border-primary/30">
                  <code className="text-[11px] font-mono truncate flex-1 text-muted-foreground group-hover/api:text-foreground transition-colors">
                    {metadata?.api || fullApiUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 opacity-40 group-hover/api:opacity-100"
                    onClick={() => handleCopy(fullApiUrl)}
                    title="Copy API URL"
                  >
                    <Copy className="size-3" />
                  </Button>
                </dd>
              </div>
            )}

            <Separator className="col-span-full bg-border/40" />

            <div className="space-y-3">
              {metadata?.duration !== undefined && (
                <div className="flex items-center justify-between group/item">
                  <dt className="text-xs text-muted-foreground flex items-center gap-2">
                    <Clock
                      className="size-3.5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    Duration
                  </dt>
                  <dd>
                    <Badge
                      variant="secondary"
                      className="font-mono text-xs font-medium tabular-nums bg-background/50"
                    >
                      <CopyableValue
                        value={formatDuration(metadata.duration)}
                      />
                    </Badge>
                  </dd>
                </div>
              )}

              {metadata?.rows !== undefined && (
                <div className="flex items-center justify-between group/item">
                  <dt className="text-xs text-muted-foreground flex items-center gap-2">
                    <Database
                      className="size-3.5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    Rows
                  </dt>
                  <dd>
                    <Badge
                      variant="secondary"
                      className="font-mono text-xs font-medium tabular-nums bg-background/50"
                    >
                      <CopyableValue value={metadata.rows.toLocaleString()} />
                    </Badge>
                  </dd>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t md:border-t-0 md:border-l border-border/40 pt-3 md:pt-0 md:pl-4">
              {metadata?.clickhouseVersion && (
                <div className="flex items-center justify-between group/item">
                  <dt className="text-xs text-muted-foreground flex items-center gap-2">
                    <Zap
                      className="size-3.5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    Version
                  </dt>
                  <dd>
                    <Badge
                      variant="outline"
                      className="font-mono text-[11px] border-border/40"
                    >
                      <CopyableValue value={metadata.clickhouseVersion} />
                    </Badge>
                  </dd>
                </div>
              )}

              {metadata?.queryId && (
                <div className="flex flex-col gap-1 group/item">
                  <dt className="text-xs text-muted-foreground flex items-center gap-2">
                    <Hash
                      className="size-3.5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    Query ID
                  </dt>
                  <dd className="bg-background/50 rounded px-2 py-1 border border-border/40">
                    <CopyableValue
                      value={metadata.queryId}
                      className="text-[10px] w-full"
                    />
                  </dd>
                </div>
              )}
            </div>
          </div>

          {/* Data status (e.g. partial / empty results) */}
          {metadata?.statusMessage && (
            <p className="mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
              {metadata.statusMessage}
            </p>
          )}
        </div>
      )}

      {/* SQL code display */}
      {sql && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
              <CodeIcon className="size-3.5 text-primary" strokeWidth={2} />
              SQL Query
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <SparklesIcon className="size-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Beautify</span>
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
                onClick={() => handleCopy(displaySQL)}
              >
                {copied ? (
                  <Check className="size-3" strokeWidth={1.5} />
                ) : (
                  <Copy className="size-3" strokeWidth={1.5} />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="relative group/sql">
            <ScrollArea
              className={cn(
                'rounded-xl border border-border/60 bg-muted/40',
                fullScreen ? 'h-[calc(100vh-24rem)]' : 'h-[400px]'
              )}
            >
              <div
                className={cn(
                  '[&_pre]:bg-transparent! [&_pre]:p-4 [&_pre]:leading-relaxed',
                  fullScreen ? '[&_pre]:text-sm' : '[&_pre]:text-xs',
                  HLJS_TOKEN_CLASSES
                )}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </ScrollArea>

            <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover/sql:opacity-100 transition-opacity">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="secondary"
                        size="icon"
                        className="size-8 rounded-lg"
                        onClick={() => handleCopy(displaySQL)}
                        aria-label={copied ? 'Copied!' : 'Copy SQL'}
                      />
                    }
                  >
                    {copied ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {copied ? 'Copied!' : 'Copy SQL'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Info footer */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>ClickHouse SQL Dialect</span>
            <span>{displaySQL.split('\n').length} lines</span>
          </div>
        </>
      )}
    </div>
  )
}

export const DialogSQL = function DialogSQL({
  button,
  title = 'SQL Code',
  description = 'Raw SQL code of this table',
  sql,
  fullScreen = true,
  metadata,
  defaultBeautify = false,
  ...props
}: ShowSQLButtonProps) {
  if (!sql) {
    return null
  }

  return (
    <DialogContent
      button={
        button ? (
          button
        ) : (
          <Button
            variant="outline"
            className="ml-auto"
            aria-label="Show SQL"
            title="Show SQL for this table"
          >
            <CodeIcon className="size-4" />
          </Button>
        )
      }
      title={title}
      description={description}
      content={
        <RequestInfoContent
          sql={sql}
          metadata={metadata}
          fullScreen={fullScreen}
          defaultBeautify={defaultBeautify}
        />
      }
      contentClassName={cn(
        'max-w-[95vw] md:max-w-[90vw] lg:max-w-[85vw]',
        fullScreen && '!max-w-[98vw]'
      )}
      {...props}
    />
  )
}
