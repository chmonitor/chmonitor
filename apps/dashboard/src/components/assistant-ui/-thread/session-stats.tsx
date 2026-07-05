'use client'

/**
 * Conversation-level ("session") stats aggregate (Task B5 / #2074).
 *
 * `message-stats.tsx` renders strong PER-MESSAGE stats, but there was no
 * cumulative view of the whole thread. `SessionStats` sums each assistant
 * message's usage into a conversation-level total — tokens, cumulative
 * estimated cost, and tool-call count — rendered as a compact row in the
 * thread footer.
 *
 * The per-message cost is already computed server-side and surfaced through
 * `extractMessageUsage(...).estimatedCostUsd` (the SAME source
 * `message-stats.tsx` reads). We reuse that extractor here and simply sum the
 * results, so this file never duplicates or edits the per-message logic.
 */

import { CpuIcon, DollarSignIcon, WrenchIcon } from 'lucide-react'

import { useThread } from '@assistant-ui/react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { extractMessageUsage } from '@/lib/ai/agent/message-metadata'

interface SessionTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Cumulative estimated cost across messages with a known price. */
  costUsd: number
  /** True when at least one message contributed a known (non-null) cost. */
  hasKnownCost: boolean
  toolCount: number
  messageCount: number
}

const EMPTY_TOTALS: SessionTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  hasKnownCost: false,
  toolCount: 0,
  messageCount: 0,
}

/**
 * Aggregate per-message usage from every assistant message in the thread.
 * Mirrors the token/tool extraction in `message-stats.tsx` (data-usage part
 * with a step-level fallback) but accumulates across the whole conversation.
 */
function useSessionTotals(): SessionTotals {
  const messages = useThread((thread) => thread.messages)

  const totals: SessionTotals = { ...EMPTY_TOTALS }

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    // assistant-ui exposes the AI SDK parts array as `message.content`;
    // extractMessageUsage expects `{ parts }` (same cast as message-stats).
    const content = message.content as readonly unknown[]
    const usage = extractMessageUsage({ parts: content } as Parameters<
      typeof extractMessageUsage
    >[0])

    // Token total: prefer data-usage, fall back to summing step usage.
    let inputTokens = usage?.totalInputTokens ?? 0
    let outputTokens = usage?.totalOutputTokens ?? 0
    if (!usage) {
      const steps = (message.metadata as { steps?: unknown } | undefined)
        ?.steps as
        | { usage?: { inputTokens?: number; outputTokens?: number } }[]
        | undefined
      if (steps && steps.length > 0) {
        for (const step of steps) {
          inputTokens += step.usage?.inputTokens ?? 0
          outputTokens += step.usage?.outputTokens ?? 0
        }
      }
    }

    const messageTokens = inputTokens + outputTokens
    totals.inputTokens += inputTokens
    totals.outputTokens += outputTokens
    totals.totalTokens += messageTokens

    // Cumulative cost — only messages with a known (non-null) cost contribute.
    if (usage?.estimatedCostUsd != null) {
      totals.costUsd += usage.estimatedCostUsd
      totals.hasKnownCost = true
    }

    // Tool-call count (same predicate as the per-message footer).
    totals.toolCount +=
      (content as { type?: string }[]).filter(
        (p) =>
          p?.type === 'tool-call' || (p?.type?.startsWith('tool-') ?? false)
      ).length ?? 0

    if (messageTokens > 0) totals.messageCount += 1
  }

  return totals
}

function formatCost(costUsd: number): string {
  if (costUsd === 0) return 'free'
  if (costUsd < 0.0001) return '<$0.0001'
  return `$${costUsd.toFixed(4)}`
}

/**
 * Compact conversation-level stats row for the thread footer.
 * Renders nothing for an empty conversation (or one with no usable metrics).
 */
export function SessionStats() {
  const totals = useSessionTotals()

  const hasTokens = totals.totalTokens > 0
  const hasTools = totals.toolCount > 0

  // Empty conversation, or nothing meaningful yet → render nothing.
  if (!hasTokens && !hasTools) return null

  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/55">
      <span className="uppercase tracking-wide text-muted-foreground/45">
        Session
      </span>

      {hasTokens && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex cursor-default items-center gap-0.5" />
            }
          >
            <CpuIcon className="size-2.5 shrink-0" />
            <span className="font-mono tabular-nums">
              {totals.totalTokens.toLocaleString()}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <span className="font-mono tabular-nums">
              {totals.inputTokens.toLocaleString()} in ·{' '}
              {totals.outputTokens.toLocaleString()} out
            </span>
          </TooltipContent>
        </Tooltip>
      )}

      {totals.hasKnownCost && (
        <span className="flex items-center gap-0.5">
          <DollarSignIcon className="size-2.5 shrink-0" />
          <span className="font-mono tabular-nums">
            {formatCost(totals.costUsd)}
          </span>
        </span>
      )}

      {hasTools && (
        <span className="flex items-center gap-0.5">
          <WrenchIcon className="size-2.5 shrink-0" />
          <span className="font-mono tabular-nums">{totals.toolCount}</span>
        </span>
      )}
    </div>
  )
}
