import type { ExplainAnalysis } from '@/lib/explain-heuristics'

import { useCallback, useState } from 'react'
import { SuggestionChip } from '@/components/explain/suggestion-chip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'
import { analyzeExplain } from '@/lib/explain-heuristics'
import { apiFetch } from '@/lib/swr/api-fetch'

interface QueryItem {
  sql: string
  title: string
  readRows?: number
  resultRows?: number
}

interface BulkExplainDialogProps {
  queries: QueryItem[]
  hostId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ExplainApiResponse {
  data: Array<{ explain: string }>
  metadata: { sql: string }
}

const N_OPTIONS = [1, 3, 5, 10, 20] as const

/**
 * Sequentially EXPLAIN the top N queries and surface heuristic suggestions.
 *
 * Results are shown one by one as they arrive. "Ask AI about all findings"
 * links to /agents with the context pre-populated in the URL.
 */
export function BulkExplainDialog({
  queries,
  hostId,
  open,
  onOpenChange,
}: BulkExplainDialogProps) {
  const [n, setN] = useState(5)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [results, setResults] = useState<ExplainAnalysis[]>([])
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set())

  const selected = queries.slice(0, n)

  const runAnalysis = useCallback(async () => {
    setRunning(true)
    setResults([])
    setProgress(0)
    setExpandedIdx(new Set())

    const collected: ExplainAnalysis[] = []

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i]
      setProgress(i + 1)

      try {
        const url = `/api/v1/explain?hostId=${hostId}&query=${encodeURIComponent(item.sql)}`
        const res = await apiFetch(url)
        if (!res.ok) {
          const errData = (await res.json()) as { error?: { message?: string } }
          collected.push({
            sql: item.sql,
            title: item.title,
            planLines: [],
            suggestions: [],
            ok: false,
            error: errData.error?.message ?? `HTTP ${res.status}`,
          })
        } else {
          const json = (await res.json()) as ExplainApiResponse
          const planLines = json.data.map((r) => r.explain)
          const suggestions = analyzeExplain(
            item.sql,
            planLines,
            item.readRows,
            item.resultRows
          )
          collected.push({
            sql: item.sql,
            title: item.title,
            planLines,
            suggestions,
            ok: true,
          })
        }
      } catch (err) {
        collected.push({
          sql: item.sql,
          title: item.title,
          planLines: [],
          suggestions: [],
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Render each result as it arrives.
      setResults([...collected])
    }

    setRunning(false)
    setProgress(null)
  }, [selected, hostId])

  const totalSuggestions = results.reduce(
    (acc, r) => acc + r.suggestions.length,
    0
  )

  const agentUrl = (() => {
    if (results.length === 0) return '/agents'
    const summary = results
      .map(
        (r) =>
          `Query: ${r.title}\nIssues: ${r.suggestions.map((s) => s.title).join(', ') || 'none'}`
      )
      .join('\n\n')
    return `/agents?message=${encodeURIComponent(`Please help optimize these ClickHouse queries:\n\n${summary}`)}`
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            Explain top N queries
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-hidden px-5 py-4">
          {/* N selector + run button */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">Analyze top</span>
            <div className="flex items-center gap-1">
              {N_OPTIONS.map((opt) => {
                const disabled = opt > queries.length
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={disabled}
                    onClick={() => setN(opt)}
                    className={[
                      'rounded-md border px-2.5 py-1 text-[11.5px] font-medium tabular-nums transition-colors',
                      disabled
                        ? 'cursor-not-allowed opacity-40'
                        : n === opt
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            <span className="text-sm text-muted-foreground">queries</span>
            <Button
              size="sm"
              className="ml-auto h-8 text-[12px]"
              onClick={runAnalysis}
              disabled={running || queries.length === 0}
            >
              {running ? 'Analyzing…' : 'Run Analysis'}
            </Button>
          </div>

          {/* Progress */}
          {running && progress !== null && (
            <p className="text-[12px] text-muted-foreground">
              Analyzing {progress} of {selected.length}…
            </p>
          )}

          {/* Results */}
          {results.length > 0 && (
            <ScrollArea className="max-h-[55vh] rounded-md border">
              <div className="divide-y">
                {results.map((result, idx) => {
                  const isExpanded = expandedIdx.has(idx)
                  return (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <p className="truncate font-mono text-[11.5px] text-foreground">
                            {result.title}
                          </p>
                          {result.ok ? (
                            <div className="flex flex-wrap gap-1">
                              {result.suggestions.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground">
                                  No issues found
                                </span>
                              ) : (
                                <TooltipProvider>
                                  {result.suggestions.map((s) => (
                                    <SuggestionChip
                                      key={s.id}
                                      suggestion={s}
                                      sql={result.sql}
                                    />
                                  ))}
                                </TooltipProvider>
                              )}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="w-fit border-red-300 bg-red-50 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400"
                            >
                              Error: {result.error}
                            </Badge>
                          )}
                        </div>
                        {result.ok && result.planLines.length > 0 && (
                          <button
                            type="button"
                            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setExpandedIdx((prev) => {
                                const next = new Set(prev)
                                if (next.has(idx)) next.delete(idx)
                                else next.add(idx)
                                return next
                              })
                            }
                          >
                            {isExpanded ? 'Hide plan' : 'Show plan'}
                          </button>
                        )}
                      </div>
                      {isExpanded && result.planLines.length > 0 && (
                        <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-[10.5px] leading-relaxed text-foreground">
                          {result.planLines.join('\n')}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}

          {/* Footer actions */}
          {results.length > 0 && !running && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-muted-foreground">
                {totalSuggestions === 0
                  ? 'No issues found across all queries.'
                  : `${totalSuggestions} suggestion${totalSuggestions === 1 ? '' : 's'} found.`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                render={<a href={agentUrl}>Ask AI about all findings</a>}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
