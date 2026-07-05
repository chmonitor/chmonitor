import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Play,
  Sparkles,
  X,
} from 'lucide-react'

import type { StatementOutcome } from './hooks/use-sql-runner'

import { DatabaseCombobox } from './database-combobox'
import { useQueryHistory } from './hooks/use-query-history'
import { useSqlRunner } from './hooks/use-sql-runner'
import { QueryHistoryPanel } from './query-history-panel'
import { AnalysisTab } from './tabs/analysis-tab'
import { ExplainTab } from './tabs/explain-tab'
import { QueryLogTab } from './tabs/query-log-tab'
import { ResultsTab } from './tabs/results-tab'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ClientOnly } from '@/components/client-only'
import {
  QueryFavoritesPanel,
  SaveFavoriteButton,
} from '@/components/query-favorites'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatSql } from '@/lib/sql-format'
import { cn } from '@/lib/utils'

// CodeMirror lives here, ALWAYS mounted and visible at the top of the console —
// never inside the result Tabs and never hidden via display:none. That is the
// structural fix for the tab-switch freeze (CM's ResizeObserver loops on a 0×0
// box). See sql-console-rebuild memory note.
const SqlEditor = lazy(() =>
  import('@/components/explorer/sql-editor').then((m) => ({
    default: m.SqlEditor,
  }))
)

export interface SqlConsoleProps {
  hostId: number
  /** Seed the editor (e.g. from URL ?q= or a selected table). */
  initialSql?: string
  /** Layout hint: 'page' fills the viewport; 'embedded' fills its container. */
  variant?: 'page' | 'embedded'
  /** Called when the committed query changes, e.g. to sync the URL. */
  onQueryCommitted?: (sql: string) => void
  /** Default database for unqualified table names (`FROM table`). */
  database?: string
  /** When provided, renders the current-database picker next to Format. */
  onDatabaseChange?: (database: string | undefined) => void
}

type ResultTabValue = 'results' | 'explain' | 'query-log' | 'analysis'

export function SqlConsole({
  hostId,
  initialSql = '',
  variant = 'page',
  onQueryCommitted,
  database,
  onDatabaseChange,
}: SqlConsoleProps) {
  const runner = useSqlRunner(hostId, initialSql, database)
  const history = useQueryHistory()
  const [tab, setTab] = useState<ResultTabValue>('results')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)

  const {
    editorValue,
    setEditorValue,
    committedSql,
    statements,
    activeIndex,
    setActiveIndex,
    activeStatement,
    run,
    cancel,
    isRunning,
    hasRun,
  } = runner

  // Log each completed run to local history exactly once (on the running→idle
  // transition for the current committed query). Aggregate across statements.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !isRunning && committedSql) {
      const ok = statements.length > 0 && statements.every((s) => !s.error)
      const rows = statements.reduce(
        (sum, s) => sum + (s.result?.rowCount ?? 0),
        0
      )
      const durationMs = statements.reduce(
        (sum, s) => sum + (s.result?.durationMs ?? 0),
        0
      )
      history.add({
        sql: committedSql,
        hostId,
        database: database ?? null,
        ok,
        rows,
        durationMs,
      })
    }
    wasRunning.current = isRunning
  }, [isRunning, committedSql, statements, hostId, history, database])

  // Notify parent when the committed query changes (URL sync, etc.).
  useEffect(() => {
    if (committedSql) onQueryCommitted?.(committedSql)
  }, [committedSql, onQueryCommitted])

  const handleRun = (sql?: string) => run(sql)

  const handleFormat = async () => {
    // formatSql falls back to the dedented original on failure, so an invalid
    // query is left untouched rather than throwing.
    const formatted = await formatSql(editorValue, {
      language: 'sql',
      keywordCase: 'upper',
      identifierCase: 'preserve',
      tabWidth: 2,
      linesBetweenQueries: 1,
    })
    setEditorValue(formatted)
  }

  const handleSelectHistory = (sql: string, runIt = false) => {
    setEditorValue(sql)
    setHistoryOpen(false)
    if (runIt) run(sql)
  }

  // Secondary tabs (EXPLAIN / Query Log / Analysis) follow the active statement.
  const activeSql = activeStatement?.sql ?? committedSql
  const activeQueryId = activeStatement?.result?.queryId ?? null

  return (
    <div
      className={
        variant === 'page'
          ? 'flex h-full min-h-0 flex-col gap-3'
          : 'flex min-h-0 flex-col gap-3'
      }
    >
      {/* Editor — always mounted & visible, ABOVE the action bar */}
      <ClientOnly fallback={<Skeleton className="h-[160px] rounded-md" />}>
        <Suspense fallback={<Skeleton className="h-[160px] rounded-md" />}>
          <SqlEditor
            value={editorValue}
            onChange={setEditorValue}
            onRun={() => handleRun()}
            placeholder="SELECT * FROM system.tables LIMIT 100"
          />
        </Suspense>
      </ClientOnly>

      {/* Action bar — moved BELOW the input area */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => handleRun()}
            disabled={!editorValue.trim()}
          >
            {isRunning ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 size-3.5" />
            )}
            Run
            <kbd className="bg-primary-foreground/20 ml-1.5 hidden rounded px-1 text-[10px] sm:inline">
              ⌘↵
            </kbd>
          </Button>
          {isRunning && (
            <Button size="sm" variant="destructive" onClick={cancel}>
              <X className="mr-1.5 size-3.5" /> Cancel
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleFormat}
            disabled={!editorValue.trim()}
          >
            <Sparkles className="mr-1.5 size-3.5" /> Format
          </Button>
          <SaveFavoriteButton
            sql={committedSql ?? ''}
            hostId={hostId}
            database={database ?? null}
          />
          {onDatabaseChange && (
            <DatabaseCombobox
              hostId={hostId}
              value={database}
              onChange={onDatabaseChange}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button size="sm" variant="outline" />}>
              <History className="mr-1.5 size-3.5" /> History
            </SheetTrigger>
            <SheetContent
              side="right"
              className="flex w-[380px] flex-col p-0 sm:w-[440px]"
            >
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle>Query history</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1">
                <QueryHistoryPanel
                  hostId={hostId}
                  entries={history.entries}
                  onSelect={handleSelectHistory}
                  onRemove={history.remove}
                  onTogglePin={history.togglePin}
                  onClear={history.clear}
                  serverEnabled={historyOpen}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={favoritesOpen} onOpenChange={setFavoritesOpen}>
            <SheetTrigger render={<Button size="sm" variant="outline" />}>
              <Bookmark className="mr-1.5 size-3.5" /> Favorites
            </SheetTrigger>
            <SheetContent
              side="right"
              className="flex w-[380px] flex-col p-0 sm:w-[440px]"
            >
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle>Saved favorites</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1">
                <QueryFavoritesPanel
                  onSelect={(sql, run) => {
                    setEditorValue(sql)
                    setFavoritesOpen(false)
                    if (run) handleRun(sql)
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        isRunning={isRunning}
        hasRun={hasRun}
        statements={statements}
        activeIndex={activeIndex}
      />

      {/* Result tabs — no CodeMirror inside, safe to hide/show */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ResultTabValue)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="explain">EXPLAIN</TabsTrigger>
          <TabsTrigger value="query-log">Query Log</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        <ScrollArea className="mt-3 min-h-0 flex-1">
          <TabsContent value="results" className="mt-0">
            <ResultsArea
              statements={statements}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              isRunning={isRunning}
              hasRun={hasRun}
            />
          </TabsContent>
          <TabsContent value="explain" className="mt-0">
            <ExplainTab
              hostId={hostId}
              sql={activeSql}
              active={tab === 'explain'}
            />
          </TabsContent>
          <TabsContent value="query-log" className="mt-0">
            <QueryLogTab
              hostId={hostId}
              queryId={activeQueryId}
              active={tab === 'query-log'}
            />
          </TabsContent>
          <TabsContent value="analysis" className="mt-0">
            <AnalysisTab
              hostId={hostId}
              sql={activeSql}
              queryId={activeQueryId}
              active={tab === 'analysis'}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

/**
 * Results area. A single statement renders one table (unchanged behavior). A
 * multi-statement run renders one selectable result tab per statement, each
 * with its own rows/error.
 */
function ResultsArea({
  statements,
  activeIndex,
  setActiveIndex,
  isRunning,
  hasRun,
}: {
  statements: StatementOutcome[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  isRunning: boolean
  hasRun: boolean
}) {
  // Not run yet, or first run still in flight → defer to ResultsTab's own
  // empty/skeleton states.
  if (!hasRun || statements.length === 0) {
    return (
      <ResultsTab
        result={null}
        error={null}
        isRunning={isRunning}
        hasRun={hasRun}
      />
    )
  }

  if (statements.length === 1) {
    const only = statements[0]
    return (
      <ResultsTab
        result={only.result}
        error={only.error}
        isRunning={isRunning}
        hasRun={hasRun}
      />
    )
  }

  const active = statements[activeIndex] ?? statements[0]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {statements.map((s, i) => (
          <button
            key={`${i}-${s.sql.slice(0, 16)}`}
            type="button"
            onClick={() => setActiveIndex(i)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
              i === activeIndex
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            <span className="font-medium">Result {i + 1}</span>
            {s.error ? (
              <AlertCircle className="size-3 text-destructive" />
            ) : (
              <span className="opacity-70">
                {(s.result?.rowCount ?? 0).toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>
      <ResultsTab
        result={active.result}
        error={active.error}
        isRunning={false}
        hasRun
      />
    </div>
  )
}

function StatusBar({
  isRunning,
  hasRun,
  statements,
  activeIndex,
}: {
  isRunning: boolean
  hasRun: boolean
  statements: StatementOutcome[]
  activeIndex: number
}) {
  if (!hasRun) return null

  const active = statements[activeIndex] ?? statements[0] ?? null
  const hasError = Boolean(active?.error)
  const rows = active?.result?.rowCount
  const durationMs = active?.result?.durationMs
  const queryId = active?.result?.queryId ?? null
  const multi = statements.length > 1

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
      {isRunning ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" /> Running…
        </span>
      ) : hasError ? (
        <Badge variant="destructive" className="text-xs">
          Error
        </Badge>
      ) : (
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3" /> Success
        </span>
      )}
      {multi && (
        <span>
          Statement {activeIndex + 1}/{statements.length}
        </span>
      )}
      {!isRunning && !hasError && rows !== undefined && (
        <span>{rows.toLocaleString()} rows</span>
      )}
      {!isRunning && durationMs !== undefined && (
        <span className="flex items-center gap-1">
          <Clock className="size-3" /> {durationMs} ms
        </span>
      )}
      {queryId && (
        <code className="text-[11px] opacity-70" title={queryId}>
          {queryId.slice(0, 8)}…
        </code>
      )}
    </div>
  )
}
