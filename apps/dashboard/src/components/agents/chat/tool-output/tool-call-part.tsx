'use client'

import { ChevronDownIcon, ChevronRightIcon, DownloadIcon } from 'lucide-react'

import {
  createResultQueryConfig,
  getPromotedOutputType,
  getRowsFromOutput,
} from './output-shape'
import {
  renderRawOutput,
  renderStructuredOutput,
  renderToolOutput,
} from './renderers'
import { downloadCsv, ExpandTableButton } from './result-table'
import { getToolMetadata } from '@chm/mcp-server/data'
import { type ReactNode, useEffect, useState } from 'react'
import {
  AskUserWidget,
  isAskUserOutput,
} from '@/components/agents/ask-user-widget'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

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
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--chart-yellow)]">
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
              isActive && 'animate-pulse bg-[var(--chart-yellow)]',
              hasOutput && 'bg-[var(--chart-green)]',
              hasError && 'bg-destructive'
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
                className="shrink-0 text-[10px] text-[var(--chart-green)]"
              >
                ✓ Done
              </Badge>
            )}
            {hasError && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] text-destructive"
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
