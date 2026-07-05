'use client'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  Maximize2Icon,
} from 'lucide-react'

import type { AgentDataSourcesProps } from '@/components/agents/agent-data-sources'
import type { AgentVisualizationProps } from '@/components/agents/agent-visualization'
import type { QueryConfig } from '@/types/query-config'

import { QueryInsightsCard } from './query-insights-card'
import { isCloudflareWorkers } from '@chm/clickhouse-client/runtime/cloudflare-workers'
import { getToolMetadata } from '@chm/mcp-server/data'
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { AdvisorRecommendationsPanel } from '@/components/agents/advisor-recommendations-panel'
import { AgentChartRenderer } from '@/components/agents/agent-chart-renderer'
import { AgentDashboardSuggestion } from '@/components/agents/agent-dashboard-suggestion'
import { AgentDataSources } from '@/components/agents/agent-data-sources'
import {
  AgentIssuesPanel,
  QueryRepairPanel,
  TableDesignPanel,
} from '@/components/agents/agent-diagnostics'
import { AgentVisualization } from '@/components/agents/agent-visualization'
import {
  AgentWorkflowPlan,
  type WorkflowPlanStep,
} from '@/components/agents/agent-workflow-plan'
import {
  AskUserWidget,
  isAskUserOutput,
} from '@/components/agents/ask-user-widget'
import { DataTable } from '@/components/data-table/data-table'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Stable empty context object — avoids new reference on every render which
// would defeat column-def memoization inside DataTable.
const EMPTY_TABLE_CONTEXT: Record<string, string> = {}

export interface AgentToolPart {
  readonly type: string
  readonly toolCallId: string
  readonly toolName?: string
  readonly state: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
  readonly title?: string
}

interface ToolCallPartProps {
  readonly part: AgentToolPart
  readonly onToolResult?: (toolCallId: string, result: string) => void
  readonly isMessageStreaming?: boolean
}

function createResultQueryConfig(columns: string[]): QueryConfig<string[]> {
  return {
    name: 'agent-query-result',
    description: 'Query results from AI agent',
    sql: 'SELECT * FROM agent_result',
    columns,
  }
}

function getRowsFromOutput(output: unknown): Record<string, unknown>[] {
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0]
    if (typeof first === 'object' && first !== null) {
      return output as Record<string, unknown>[]
    }
  }

  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>
    if (Array.isArray(obj.rows) && obj.rows.length > 0) {
      return obj.rows as Record<string, unknown>[]
    }
  }

  return []
}

function getPromotedOutputType(output: unknown) {
  if (typeof output !== 'object' || output === null) return null

  const outputObj = output as Record<string, unknown>
  if (
    outputObj.type === 'query_insights' &&
    Array.isArray(outputObj.highlights)
  ) {
    return 'query_insights' as const
  }
  if (outputObj.type === 'visualization' && Array.isArray(outputObj.rows)) {
    return 'visualization' as const
  }
  if (outputObj.type === 'data_sources' && Array.isArray(outputObj.sources)) {
    return 'data_sources' as const
  }
  if (outputObj.type === 'workflow_plan' && Array.isArray(outputObj.steps)) {
    return 'workflow_plan' as const
  }
  if (
    outputObj.type === 'dashboard_suggestion' &&
    typeof outputObj.layout === 'object' &&
    outputObj.layout !== null
  ) {
    return 'dashboard_suggestion' as const
  }
  if (outputObj.type === 'agent_issues' && Array.isArray(outputObj.issues)) {
    return 'agent_issues' as const
  }
  if (outputObj.type === 'query_repair') {
    return 'query_repair' as const
  }
  if (
    outputObj.type === 'table_design_recommendation' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return 'table_design_recommendation' as const
  }

  return null
}

export function ResultTable({
  rows,
  maxRows = 100,
}: {
  readonly rows: readonly unknown[]
  readonly maxRows?: number
}) {
  const displayRows = rows.slice(0, maxRows) as Record<string, unknown>[]

  const columns = (() => {
    if (displayRows.length === 0) return []
    return Object.keys(displayRows[0])
  })()

  const queryConfig = createResultQueryConfig(columns)

  if (columns.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No columns to display
      </div>
    )
  }

  const footnote =
    rows.length > maxRows ? `Showing ${maxRows} of ${rows.length} rows` : ' '

  return (
    <DataTable
      data={displayRows}
      queryConfig={queryConfig}
      context={EMPTY_TABLE_CONTEXT}
      defaultPageSize={Math.min(displayRows.length, 25)}
      showSQL={false}
      enableColumnFilters={false}
      enableColumnReordering={false}
      compact
      footnote={footnote}
    />
  )
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h]
          const str = val === null || val === undefined ? '' : String(val)
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str
        })
        .join(',')
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExpandTableButton({
  rows,
  queryConfig,
}: {
  readonly rows: Record<string, unknown>[]
  readonly queryConfig: QueryConfig<string[]>
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Expand table"
            title="Expand table"
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <Maximize2Icon className="size-3" />
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-[95vw] flex-col">
        <DialogHeader>
          <DialogTitle>Query Results ({rows.length} rows)</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <DataTable
            data={rows}
            queryConfig={queryConfig}
            context={EMPTY_TABLE_CONTEXT}
            defaultPageSize={50}
            showSQL={false}
            enableColumnFilters={true}
            enableColumnReordering={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function renderStructuredOutput(output: unknown): ReactNode {
  if (output == null) return null

  const outputObj = output as Record<string, unknown>

  // Query insights - rendered as stat cards
  if (
    outputObj.type === 'query_insights' &&
    Array.isArray(outputObj.highlights)
  ) {
    return (
      <QueryInsightsCard
        insights={
          output as ComponentProps<typeof QueryInsightsCard>['insights']
        }
      />
    )
  }

  // Skip heavy chart rendering on Cloudflare Workers to avoid resource limits
  // Fall back to simple data table instead
  if (outputObj.type === 'visualization' && Array.isArray(outputObj.rows)) {
    if (isCloudflareWorkers()) {
      return (
        <div className="space-y-3">
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium">
              Interactive charts disabled on Workers
            </p>
            <p className="mt-1">
              Charts are disabled in this deployment to avoid resource limits.{' '}
              <a
                href="https://github.com/chmonitor/chmonitor/blob/main/docs/deployment.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Use Docker deployment for full chart support.
              </a>
            </p>
          </div>
          <ResultTable rows={outputObj.rows as unknown[]} maxRows={100} />
        </div>
      )
    }
    return (
      <AgentVisualization
        title={outputObj.title as string | undefined}
        sql={outputObj.sql as string}
        rows={outputObj.rows as Record<string, unknown>[]}
        columns={outputObj.columns as string[]}
        rowCount={outputObj.rowCount as number}
        viz={outputObj.viz as AgentVisualizationProps['viz']}
      />
    )
  }

  if (outputObj.type === 'data_sources' && Array.isArray(outputObj.sources)) {
    return (
      <AgentDataSources
        searchTerm={outputObj.searchTerm as string}
        sources={outputObj.sources as AgentDataSourcesProps['sources']}
      />
    )
  }

  if (outputObj.type === 'workflow_plan' && Array.isArray(outputObj.steps)) {
    return (
      <AgentWorkflowPlan
        steps={outputObj.steps as WorkflowPlanStep[]}
        note={outputObj.note as string | undefined}
        workflow={outputObj.workflow as string | undefined}
        total={outputObj.total as number | undefined}
        completed={outputObj.completed as number | undefined}
      />
    )
  }

  if (
    outputObj.type === 'dashboard_suggestion' &&
    typeof outputObj.layout === 'object' &&
    outputObj.layout !== null
  ) {
    return (
      <AgentDashboardSuggestion
        request={outputObj.request as string}
        name={outputObj.name as string}
        layout={
          outputObj.layout as ComponentProps<
            typeof AgentDashboardSuggestion
          >['layout']
        }
        chartCount={outputObj.chartCount as number}
      />
    )
  }

  if (outputObj.type === 'agent_issues' && Array.isArray(outputObj.issues)) {
    return (
      <AgentIssuesPanel
        output={output as ComponentProps<typeof AgentIssuesPanel>['output']}
      />
    )
  }

  if (outputObj.type === 'query_repair') {
    return (
      <QueryRepairPanel
        output={output as ComponentProps<typeof QueryRepairPanel>['output']}
      />
    )
  }

  if (
    outputObj.type === 'table_design_recommendation' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return (
      <TableDesignPanel
        output={output as ComponentProps<typeof TableDesignPanel>['output']}
      />
    )
  }

  if (
    outputObj.type === 'query_advisor_recommendations' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return (
      <AdvisorRecommendationsPanel
        output={
          output as ComponentProps<typeof AdvisorRecommendationsPanel>['output']
        }
      />
    )
  }

  if (Array.isArray(output) && output.length > 0) {
    const firstItem = output[0]
    if (typeof firstItem === 'object' && firstItem !== null) {
      return <ResultTable rows={output} maxRows={100} />
    }
  }

  if (
    outputObj.chartData &&
    Array.isArray(outputObj.chartData) &&
    outputObj.chartData.length > 0
  ) {
    return (
      <AgentChartRenderer
        type={
          (outputObj.chartType as 'area' | 'bar' | 'donut' | undefined) || 'bar'
        }
        data={outputObj.chartData as readonly Record<string, unknown>[]}
        title={outputObj.chartTitle as string | undefined}
        xKey={outputObj.xKey as string | undefined}
        yKey={outputObj.yKey as string | undefined}
        categories={outputObj.categories as string[] | undefined}
        readable={
          outputObj.readable as
            | 'bytes'
            | 'duration'
            | 'number'
            | 'quantity'
            | undefined
        }
      />
    )
  }

  if (Array.isArray(outputObj.rows) && outputObj.rows.length > 0) {
    return <ResultTable rows={outputObj.rows as unknown[]} maxRows={100} />
  }

  // No structured renderer matched → let the caller decide (raw JSON is shown
  // via renderRawOutput, kept behind a collapsed "Response" disclosure).
  return null
}

/**
 * Raw fallback: the tool output as a JSON / text blob. Rendered only when no
 * structured renderer matches, and kept behind a collapsed disclosure so it
 * never clutters the row.
 */
function renderRawOutput(output: unknown): ReactNode {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
      {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
    </pre>
  )
}

/**
 * Renders a tool output. Structured shapes (charts, tables, insight /
 * diagnostic cards) render richly; anything else falls back to the raw JSON
 * blob. `renderStructuredOutput` is the SINGLE source of truth for "is there a
 * rich render?" — callers that must distinguish rich vs. raw call it directly
 * (non-null ⇒ rich), so the render path and the disclosure decision never drift.
 */
export function renderToolOutput(output: unknown): ReactNode {
  return renderStructuredOutput(output) ?? renderRawOutput(output)
}

/**
 * Animated ellipsis — the single "in progress" motion for a running tool.
 * Three dots pulse in a staggered wave; `bg-current` inherits the label colour.
 */
function AnimatedDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 200, 400].map((delay) => (
        <span
          key={delay}
          className="size-1 shrink-0 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * The one, unmistakable "Running…" acknowledgement — replaces the old scattered
 * label + "Executing…" badge + body spinner with a single animated indicator.
 */
function RunningIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
      Running
      <AnimatedDots />
    </span>
  )
}

/**
 * Collapsed-by-default subsection inside an expanded tool row (Parameters / raw
 * Response). Matches the reasoning + tool-group chevron and collapse animation.
 */
function RowDisclosure({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  readonly label: string
  readonly count?: number
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/disclosure">
      <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/disclosure:rotate-90" />
        <span>{label}</span>
        {count != null ? (
          <span className="tabular-nums tracking-normal text-muted-foreground/60">
            {count}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pt-1 pb-1.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Non-promoted tool output. Rich structured renders (ResultTable, charts,
 * advisor recommendations) stay visible; a raw JSON blob collapses behind a
 * "Response" disclosure so the row stays clean by default.
 */
function ToolResponse({ output }: { readonly output: unknown }) {
  const structured = renderStructuredOutput(output)
  if (structured != null) {
    return <div className="pb-1">{structured}</div>
  }
  return (
    <RowDisclosure label="Response">{renderRawOutput(output)}</RowDisclosure>
  )
}

export function ToolCallPart({
  part,
  onToolResult,
  isMessageStreaming,
}: ToolCallPartProps) {
  const toolName = part.toolName || part.type.replace('tool-', '')
  const isStarting =
    part.state === 'input-streaming' || part.state === 'input-available'
  const isStreaming = part.state === 'output-streaming'
  const hasOutput = part.state === 'output-available'
  const hasError = part.state === 'output-error'
  const shouldAutoExpand = isStreaming || hasError || isStarting
  // A tool is "active" while its input is streaming in or it is executing —
  // the whole window that shows the single animated "Running…" indicator.
  const isActive = isStarting || isStreaming
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand)

  useEffect(() => {
    if (shouldAutoExpand) setIsExpanded(true)
  }, [shouldAutoExpand])

  // Collapse a finished row into tidy history only once the WHOLE turn is done
  // (`isMessageStreaming` is the message-level streaming flag, not this tool's).
  // Staying expanded until then keeps the active row + its output visible right
  // through the assistant's final text, instead of collapsing mid-stream.
  useEffect(() => {
    if (!isMessageStreaming && hasOutput && !hasError && isExpanded) {
      const timer = setTimeout(() => setIsExpanded(false), 800)
      return () => clearTimeout(timer)
    }
  }, [isMessageStreaming, hasOutput, hasError, isExpanded])

  const inputParams = (() => {
    if (!part.input || typeof part.input !== 'object') return null
    return Object.entries(part.input as Record<string, unknown>)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ')
  })()

  const inputParamCount =
    part.input && typeof part.input === 'object'
      ? Object.keys(part.input as Record<string, unknown>).length
      : 0
  const hasInputParams = inputParamCount > 0

  const toolParams = (() => {
    const tool = getToolMetadata(toolName)
    return tool?.params || []
  })()

  const outputRows = (() => {
    if (!hasOutput || !part.output) return []
    return getRowsFromOutput(part.output)
  })()

  const outputQueryConfig = (() => {
    if (outputRows.length === 0) return null
    return createResultQueryConfig(Object.keys(outputRows[0]))
  })()

  const promotedOutput = (() => {
    if (!hasOutput || part.output == null) return null
    return getPromotedOutputType(part.output)
  })()

  return (
    <div className="my-1">
      {/* Tool row — no outer box; left accent bar when expanded */}
      <div
        className={cn(
          'flex w-full items-center transition-colors',
          isExpanded
            ? 'border-l-2 border-border/50 pl-2'
            : 'border-l-2 border-transparent pl-2 hover:border-border/30'
        )}
      >
        <button
          type="button"
          onClick={() => setIsExpanded((previous) => !previous)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
          aria-expanded={isExpanded}
        >
          <span className="text-muted-foreground shrink-0">
            {isExpanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </span>

          <div
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              isActive && 'animate-pulse bg-amber-500',
              hasOutput && 'bg-emerald-500',
              hasError && 'bg-red-500'
            )}
          />

          <div className="flex min-w-0 items-center gap-1.5">
            {isActive ? (
              <RunningIndicator />
            ) : (
              <span className="text-muted-foreground text-xs">
                {hasError ? 'Failed' : 'Ran'}
              </span>
            )}
            <span className="font-mono text-xs font-medium">{toolName}</span>
            {inputParams && (
              <span className="text-muted-foreground/70 truncate font-mono text-xs">
                {inputParams}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {hasOutput && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                ✓ Done
              </Badge>
            )}
            {hasError && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] text-red-600 dark:text-red-400"
              >
                ✗ Failed
              </Badge>
            )}
          </div>
        </button>

        {hasOutput && outputRows.length > 0 && outputQueryConfig && (
          <div className="shrink-0 flex items-center gap-1 pr-1">
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Download CSV"
              title="Download CSV"
              onClick={(event) => {
                event.stopPropagation()
                downloadCsv(outputRows, `${toolName}-results.csv`)
              }}
            >
              <DownloadIcon className="size-3" />
            </button>
            <ExpandTableButton
              rows={outputRows}
              queryConfig={outputQueryConfig}
            />
          </div>
        )}
      </div>

      {/* Expanded body — indented under the accent bar, no extra background.
          Clean by default: rich output stays visible, while the raw params
          dump and raw JSON response collapse into opt-in disclosures. */}
      {isExpanded ? (
        <div className="pl-4 pt-1">
          {hasError && Boolean(part.errorText) ? (
            <div className="pb-1.5 text-sm text-destructive">
              {String(part.errorText)}
            </div>
          ) : null}

          {/* Output: the interactive ask-user widget and rich structured
              renders stay visible; a raw JSON blob collapses behind "Response".
              Promoted outputs render outside this block (always visible). */}
          {hasOutput && part.output != null && !promotedOutput ? (
            isAskUserOutput(part.output) && onToolResult ? (
              <div className="pb-1">
                <AskUserWidget
                  output={part.output}
                  toolCallId={part.toolCallId}
                  onSubmit={onToolResult}
                />
              </div>
            ) : (
              <ToolResponse output={part.output} />
            )
          ) : null}

          {/* Parameters — collapsed by default so the row reads clean */}
          {hasInputParams ? (
            <RowDisclosure label="Parameters" count={inputParamCount}>
              <div className="space-y-1">
                {Object.entries(part.input as Record<string, unknown>).map(
                  ([key, value]) => {
                    const paramDef = toolParams.find((p) => p.name === key)
                    const isOptional = paramDef?.required === false
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className={cn(
                            'font-mono',
                            isOptional
                              ? 'text-muted-foreground'
                              : 'font-medium text-foreground'
                          )}
                        >
                          {key}
                        </span>
                        <span className="text-muted-foreground">:</span>
                        <span className="font-mono text-muted-foreground">
                          {JSON.stringify(value)}
                        </span>
                        {isOptional ? (
                          <span className="text-[10px] text-muted-foreground/60">
                            (optional)
                          </span>
                        ) : null}
                      </div>
                    )
                  }
                )}
              </div>
            </RowDisclosure>
          ) : null}
        </div>
      ) : null}

      {/* Promoted outputs rendered flat — card keeps its own border, no wrapper */}
      {hasOutput && promotedOutput && part.output != null ? (
        <div className="mt-1.5">{renderToolOutput(part.output)}</div>
      ) : null}
    </div>
  )
}
