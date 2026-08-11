import { Check, ChevronDown, ChevronRight, Copy, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { useSqlBeautifyPref } from './use-sql-beautify-pref'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { highlightCode } from '@/components/ai-elements/code-block'
import { HLJS_TOKEN_CLASSES } from '@/components/ai-elements/hljs-token-classes'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatSql } from '@/lib/sql-format'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/utils/clipboard'

/** Compact labeled value in the header card info grid. */
export function MetaField({
  label,
  value,
  mono = false,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd
        className={cn(
          'truncate text-[12.5px] font-medium',
          mono && 'font-mono'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

/** Expandable card for ProfileEvents or Settings map data. */
export const CollapsibleSection = function CollapsibleSection({
  title,
  entries,
}: {
  title: string
  entries: [string, string][]
}) {
  const [open, setOpen] = useState(false)

  if (entries.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="text-[12.5px] font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {entries.map(([key, val]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2 text-[11.5px] last:border-b-0 sm:border-b"
              >
                <span className="min-w-0 truncate font-mono text-muted-foreground">
                  {key}
                </span>
                <span className="shrink-0 font-mono font-medium tabular-nums">
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Inline SQL panel: syntax-highlighted (highlight.js) with a lazy-loaded
 * Beautify toggle (off by default — `sql-formatter` is ~484K and only fetched
 * on first toggle) and copy-to-clipboard. Mirrors the DialogSQL /
 * CodeDialogFormat pattern and shares the `'sql-beautify'` localStorage key so
 * a user's beautify preference carries across SQL surfaces (see
 * `useSqlBeautifyPref`).
 */
export function SqlBlock({ query }: { query: string }) {
  const [beautify, setBeautify] = useSqlBeautifyPref()
  const [content, setContent] = useState(query)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beautifyId = useId()

  // Show the raw query immediately; when Beautify is on, swap in the formatted
  // version once the lazy sql-formatter chunk resolves (falls back to raw).
  useEffect(() => {
    if (!beautify) {
      setContent(query)
      return
    }
    let cancelled = false
    formatSql(query).then((formatted) => {
      if (!cancelled) setContent(formatted)
    })
    return () => {
      cancelled = true
    }
  }, [query, beautify])

  const highlightedHtml = useMemo(() => {
    if (!content) return ''
    try {
      return highlightCode(content, 'sql', true)
    } catch {
      return ''
    }
  }, [content])

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  const lineCount = content ? content.split('\n').length : 0

  const handleCopy = async () => {
    const success = await copyToClipboard(content)
    if (success) {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Failed to copy query')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          SQL
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {query.length.toLocaleString()} chars · {lineCount}{' '}
            {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <Label
            htmlFor={beautifyId}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Wand2 className="size-3" />
            Beautify
            <Switch
              id={beautifyId}
              checked={beautify}
              onCheckedChange={(checked) => setBeautify(checked)}
              aria-label="Toggle SQL beautification"
              className="scale-75"
            />
          </Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div className="max-h-[320px] overflow-auto">
        <div
          className={cn(
            'px-4 py-3 font-mono text-[11.5px] leading-relaxed',
            HLJS_TOKEN_CLASSES
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </div>
    </div>
  )
}
