import { SizeIcon } from '@radix-ui/react-icons'
import {
  Check,
  Copy,
  ExternalLinkIcon,
  Loader2,
  SparklesIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import dedent from 'dedent'
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { highlightCode } from '@/components/ai-elements/code-block'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatQuery } from '@/lib/format-readable'
import { formatSql } from '@/lib/sql-format'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

export interface CodeDialogOptions {
  dialog_title?: string
  dialog_description?: string
  trigger_classname?: string
  max_truncate?: number
  hide_query_comment?: boolean
  json?: boolean
  dialog_classname?: string
  show_explorer_link?: boolean
  /** Force the dialog trigger for short content; defaults to false. */
  force_dialog?: boolean
  /**
   * Render a plain, non-interactive truncated preview instead of a dialog
   * trigger. Use when the cell lives inside a clickable/expandable row: a
   * nested `<button>` would otherwise swallow the row click (see
   * `shouldExpandOnRowClick`). The full content is expected to be surfaced
   * elsewhere (e.g. an expanded detail panel). Defaults to false.
   */
  inline?: boolean
  /**
   * Add a "Query Plan" tab that runs `EXPLAIN` for the SQL. Only takes effect
   * when the detected language is SQL. Defaults to false.
   */
  show_query_plan?: boolean
}

const STORAGE_KEY = 'code-dialog-beautify'
type CodeLanguage = 'sql' | 'json' | 'plaintext'

function getInitialBeautifyState(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveBeautifyState(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* noop */
  }
}

function looksLikeSql(text: string): boolean {
  const trimmed = text.trim()
  const startsWithSql =
    /^(SELECT|INSERT|CREATE|ALTER|DROP|UPDATE|DELETE|WITH|SHOW|DESCRIBE|EXPLAIN|TRUNCATE|OPTIMIZE|ATTACH|DETACH|BACKUP|RESTORE|SYSTEM|CHECK|GRANT|REVOKE)\b/i
  const hasSelectFrom = /\bSELECT\b[\s\S]+\bFROM\b/i

  return startsWithSql.test(trimmed) || hasSelectFrom.test(trimmed)
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}

function detectLanguage(value: string, forceJson?: boolean): CodeLanguage {
  if (forceJson) return 'json'
  if (looksLikeSql(value)) return 'sql'
  if (looksLikeJson(value)) return 'json'
  return 'plaintext'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function prepareDialogContent(
  value: string,
  hideQueryComment?: boolean
): string {
  const withoutComment = hideQueryComment
    ? value.replace(/\/\*[\s\S]*?\*\//g, '')
    : value
  return dedent(withoutComment).trim()
}

function ExplorerLink({ query }: { query: string }) {
  const hostId = useHostId()
  const href = buildExplorerQueryUrl(query, hostId)
  return (
    <Button variant="ghost" size="icon" className="size-7" asChild>
      <Link href={href} title="Open in Explorer">
        <ExternalLinkIcon className="size-3.5" />
      </Link>
    </Button>
  )
}

interface ExplainResponse {
  data?: { explain?: string }[]
}

/**
 * Fetch a query plan from the EXPLAIN endpoint; surfaces API error messages.
 *
 * Uses POST so arbitrarily long queries are carried in the request body —
 * a GET would risk URL-length limits for large SQL.
 */
async function explainFetcher(
  hostId: number,
  query: string
): Promise<ExplainResponse> {
  const res = await apiFetch('/api/v1/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, query }),
  })
  const json = (await res.json().catch(() => ({}))) as ExplainResponse & {
    error?: { message?: string }
  }
  if (!res.ok) {
    throw new Error(json?.error?.message || 'Failed to load query plan')
  }
  return json
}

/** Centered status / message panel used inside the Query Plan tab. */
function PlanMessage({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}

/**
 * Query Plan tab body: runs `EXPLAIN` for the SQL via `/api/v1/explain`.
 *
 * ClickHouse only explains read statements, so non-SELECT/WITH queries skip
 * the network call entirely. The fetch is lazy — this component only mounts
 * when the user opens the dialog and switches to the plan tab.
 */
function QueryPlanPanel({
  query,
  hideQueryComment,
}: {
  query: string
  hideQueryComment?: boolean
}) {
  const hostId = useHostId()
  const cleanQuery = useMemo(
    () => prepareDialogContent(query, hideQueryComment ?? true),
    [query, hideQueryComment]
  )
  const isExplainable = /^\s*(SELECT|WITH)\b/i.test(cleanQuery)
  const { data, error, isPending } = useQuery<ExplainResponse>({
    queryKey: ['explain', hostId, cleanQuery],
    queryFn: () => explainFetcher(hostId, cleanQuery),
    enabled: isExplainable,
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  })

  if (!isExplainable) {
    return (
      <PlanMessage>
        Query plans are only available for SELECT / WITH statements.
      </PlanMessage>
    )
  }

  const planText = (data?.data ?? [])
    .map((row) => row?.explain ?? '')
    .join('\n')
    .trim()

  if (isPending && !planText) {
    return (
      <PlanMessage>
        <Loader2 className="size-4 animate-spin" />
        Running EXPLAIN…
      </PlanMessage>
    )
  }
  if (error && !planText) {
    return (
      <PlanMessage tone="error">
        {error instanceof Error ? error.message : 'Failed to load query plan'}
      </PlanMessage>
    )
  }

  if (!planText) {
    return <PlanMessage>EXPLAIN returned no output.</PlanMessage>
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-50/40 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <span className="font-medium">Warning:</span>{' '}
          {error instanceof Error
            ? error.message
            : 'Failed to refresh query plan'}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/40">
        <pre className="m-0 overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
          {planText}
        </pre>
      </ScrollArea>
    </div>
  )
}

interface CodeDialogFormatProps {
  value: string
  options?: CodeDialogOptions
}

const CODE_TRUNCATE_LENGTH = 50

export const CodeDialogFormat = memo(function CodeDialogFormat({
  value,
  options,
}: CodeDialogFormatProps): React.ReactNode {
  const truncate_length = options?.max_truncate || CODE_TRUNCATE_LENGTH
  const beautifyId = useId()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [isBeautified, setIsBeautified] = useState(false)
  const [copied, setCopied] = useState(false)

  const language = useMemo(
    () => detectLanguage(value, options?.json),
    [value, options?.json]
  )
  const dialogTitle =
    options?.dialog_title ??
    (language === 'json'
      ? 'JSON content'
      : language === 'sql'
        ? 'SQL code'
        : 'Code content')
  const dialogDescription =
    options?.dialog_description ||
    'Code content dialog with syntax highlighting and copy controls'
  const languageLabel =
    language === 'sql'
      ? 'ClickHouse SQL'
      : language === 'json'
        ? 'JSON'
        : 'Plain text'
  const showQueryPlan = Boolean(options?.show_query_plan) && language === 'sql'

  const formatted = useMemo(() => {
    return formatQuery({
      query: value,
      comment_remove: options?.hide_query_comment,
      truncate: truncate_length,
    })
  }, [value, options?.hide_query_comment, truncate_length])

  // Raw (non-beautified) content is synchronous: dialog text, plus pretty-printed
  // JSON. SQL beautify is applied separately/async below so the heavy
  // sql-formatter chunk only loads when the user toggles Beautify on.
  const baseContent = useMemo(() => {
    if (!open) return ''

    let result = prepareDialogContent(value, options?.hide_query_comment)

    if (language === 'json') {
      try {
        const json = JSON.parse(result)
        result = JSON.stringify(json, null, 2)
      } catch {}
      return result
    }

    return result
  }, [open, value, options?.hide_query_comment, language])

  // Display raw content immediately; for SQL + beautify, swap in the formatted
  // version once the lazily-loaded formatter resolves (falls back to raw on
  // error). Keeps the code body stable with no flash to empty.
  const [content, setContent] = useState(baseContent)

  useEffect(() => {
    if (!(open && isBeautified && language === 'sql' && baseContent)) {
      setContent(baseContent)
      return
    }
    let cancelled = false
    formatSql(baseContent).then((formatted) => {
      if (!cancelled) setContent(formatted)
    })
    return () => {
      cancelled = true
    }
  }, [open, isBeautified, language, baseContent])

  const lineCount = contentLineCount(content)

  const highlightedHtml = useMemo(() => {
    if (!(open && content)) return ''
    try {
      // Line numbers make multi-statement SQL far easier to scan.
      return highlightCode(content, language, language === 'sql')
    } catch {
      return `<pre class="m-0 bg-background! p-4 text-foreground! text-sm"><code class="font-mono text-sm">${escapeHtml(dedent(content))}</code></pre>`
    }
  }, [open, content, language])

  const clearCopyTimer = useCallback(() => {
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
  }, [])

  useEffect(() => clearCopyTimer, [clearCopyTimer])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      clearCopyTimer()
      if (nextOpen) {
        setCopied(false)
        setIsBeautified(getInitialBeautifyState())
      }
    },
    [clearCopyTimer]
  )

  const handleBeautifyToggle = useCallback((checked: boolean) => {
    setIsBeautified(checked)
    saveBeautifyState(checked)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return
      }
      await navigator.clipboard.writeText(content)
      setCopied(true)
      clearCopyTimer()
      copyTimerRef.current = setTimeout(() => {
        setCopied(false)
        copyTimerRef.current = null
      }, 2000)
    } catch {
      /* noop */
    }
  }, [clearCopyTimer, content])

  // Inline mode: a plain, non-interactive truncated preview so a clickable
  // parent row (e.g. an expandable table row) is never blocked by this cell.
  if (options?.inline) {
    return (
      <code
        className={cn(
          'block min-w-0 truncate font-mono text-xs text-muted-foreground',
          options?.trigger_classname
        )}
        title={value}
      >
        {formatted}
      </code>
    )
  }

  if (!options?.force_dialog && formatted.length < truncate_length) {
    return (
      <code className="whitespace-nowrap font-mono text-xs">{formatted}</code>
    )
  }

  if (!options?.force_dialog && !formatted.endsWith('...')) {
    return (
      <code className="whitespace-nowrap font-mono text-xs">{formatted}</code>
    )
  }

  // The syntax-highlighted code body + footer. Extracted so it can render
  // standalone or as the first tab when a Query Plan tab is present.
  const codeView = (
    <>
      <div className="group/code relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/40">
          <div
            className="[&_code]:break-words [&_pre]:m-0 [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_.hljs-keyword]:text-purple-600 [&_.hljs-string]:text-green-700 [&_.hljs-number]:text-blue-600 [&_.hljs-comment]:text-gray-500 [&_.hljs-built_in]:text-cyan-700 [&_.hljs-title]:text-blue-700 [&_.hljs-attr]:text-orange-600 [&_.hljs-literal]:text-blue-600 dark:[&_.hljs-keyword]:text-purple-400 dark:[&_.hljs-string]:text-green-400 dark:[&_.hljs-number]:text-blue-400 dark:[&_.hljs-comment]:text-gray-400 dark:[&_.hljs-built_in]:text-cyan-400 dark:[&_.hljs-title]:text-blue-400 dark:[&_.hljs-attr]:text-orange-400 dark:[&_.hljs-literal]:text-blue-400"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </ScrollArea>

        <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 transition-opacity group-hover/code:opacity-100">
          <Badge
            variant="secondary"
            className="bg-background/80 font-mono text-[10px]"
          >
            {language === 'plaintext' ? 'TEXT' : language.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5 text-[10px] text-muted-foreground">
        <span className="font-medium">{languageLabel}</span>
        <span className="tabular-nums">{lineCount} lines</span>
      </div>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'group/cell h-auto max-w-full justify-start gap-1.5 p-0 text-left font-normal hover:bg-transparent',
            options?.trigger_classname
          )}
        >
          <code className="min-w-0 truncate font-mono text-xs text-muted-foreground transition-colors group-hover/cell:text-foreground truncated">
            {formatted}
          </code>
          <SizeIcon className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/cell:text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'flex max-h-[min(92dvh,900px)] w-[min(95vw,1100px)] min-w-0 max-w-none flex-col overflow-hidden p-4 sm:p-6',
          options?.dialog_classname
        )}
      >
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="truncate text-base">
                {dialogTitle}
              </DialogTitle>
              {(options?.show_explorer_link ||
                options?.dialog_title === 'Running Query') && (
                <ExplorerLink query={value} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {language === 'sql' && (
                <Label
                  htmlFor={beautifyId}
                  className="gap-1.5 text-xs text-muted-foreground"
                >
                  <SparklesIcon data-icon="inline-start" />
                  <span className="text-xs text-muted-foreground">
                    Beautify
                  </span>
                  <Switch
                    id={beautifyId}
                    checked={isBeautified}
                    onCheckedChange={handleBeautifyToggle}
                    aria-label="Toggle SQL beautification"
                    className="scale-75"
                  />
                </Label>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <DialogDescription
            className={cn(!options?.dialog_description && 'sr-only')}
          >
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        {showQueryPlan ? (
          <Tabs defaultValue="query" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mb-2 h-8 self-start">
              <TabsTrigger value="query" className="px-3 text-xs">
                SQL
              </TabsTrigger>
              <TabsTrigger value="plan" className="px-3 text-xs">
                Query Plan
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="query"
              className="mt-0 flex min-h-0 flex-1 flex-col gap-1.5 outline-none"
            >
              {codeView}
            </TabsContent>
            <TabsContent
              value="plan"
              className="mt-0 flex min-h-0 flex-1 flex-col outline-none"
            >
              <QueryPlanPanel
                query={value}
                hideQueryComment={options?.hide_query_comment}
              />
            </TabsContent>
          </Tabs>
        ) : (
          codeView
        )}
      </DialogContent>
    </Dialog>
  )
})

function contentLineCount(content: string): number {
  return content ? content.split('\n').length : 0
}
