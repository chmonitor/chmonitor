'use client'

/**
 * Per-message stats footer + details dialog (Tasks #3 / #12).
 *
 * `MessageStatsFooter` renders a compact inline icon row (duration · throughput
 * · tokens · tools · model · timestamp) under each assistant message, with an
 * info button that opens `MessageStatsDialog` for the full token / timing /
 * model breakdown. Extracted from `thread.tsx` to keep that file focused on the
 * message-shell composition.
 */

import {
  ClockIcon,
  CpuIcon,
  GaugeIcon,
  InfoIcon,
  WrenchIcon,
} from 'lucide-react'

import { formatAbsolute, formatRelative } from './format'
import { useMessage, useMessageTiming } from '@assistant-ui/react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { extractMessageUsage } from '@/lib/ai/agent/message-metadata'
import { formatDuration } from '@/lib/utils'

/**
 * Detailed stats dialog content: full token breakdown, timing, model info,
 * resolved model badge, per-step data (when available), and timestamp.
 */
function MessageStatsDialog({
  timing,
  usage,
  steps,
  createdAt,
  toolCount,
}: {
  timing: ReturnType<typeof useMessageTiming>
  usage: ReturnType<typeof extractMessageUsage>
  steps: { usage?: { inputTokens?: number; outputTokens?: number } }[] | null
  createdAt: Date | undefined
  toolCount: number
}) {
  const displayModel = usage?.resolvedModel ?? usage?.model
  const requestedModel = usage?.model
  const isResolved =
    usage?.resolvedModel != null && usage.resolvedModel !== usage?.model

  return (
    <div className="space-y-4 text-sm">
      {/* Token breakdown */}
      {usage && (
        <section>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Tokens
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">Input</span>
            <span className="font-mono tabular-nums text-right">
              {usage.totalInputTokens.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Output</span>
            <span className="font-mono tabular-nums text-right">
              {usage.totalOutputTokens.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono tabular-nums text-right font-medium">
              {usage.totalTokens.toLocaleString()}
            </span>
            {usage.cacheReadTokens > 0 && (
              <>
                <span className="text-muted-foreground">Cache read</span>
                <span className="font-mono tabular-nums text-right text-muted-foreground">
                  {usage.cacheReadTokens.toLocaleString()}
                </span>
              </>
            )}
            {usage.cacheWriteTokens > 0 && (
              <>
                <span className="text-muted-foreground">Cache write</span>
                <span className="font-mono tabular-nums text-right text-muted-foreground">
                  {usage.cacheWriteTokens.toLocaleString()}
                </span>
              </>
            )}
            {usage.reasoningTokens > 0 && (
              <>
                <span className="text-muted-foreground">Reasoning</span>
                <span className="font-mono tabular-nums text-right text-muted-foreground">
                  {usage.reasoningTokens.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </section>
      )}

      {/* Per-step breakdown */}
      {steps && steps.length > 1 && (
        <section>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Per step ({steps.length} turns)
          </p>
          <div className="space-y-1">
            {steps.map((step, i) => {
              const inTok = step.usage?.inputTokens ?? 0
              const outTok = step.usage?.outputTokens ?? 0
              if (inTok === 0 && outTok === 0) return null
              return (
                <div
                  key={i}
                  className="grid grid-cols-[auto_1fr_1fr] gap-x-3 text-xs"
                >
                  <span className="text-muted-foreground/60">#{i + 1}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {inTok.toLocaleString()} in
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {outTok.toLocaleString()} out
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Timing + throughput */}
      {(timing?.totalStreamTime != null || timing?.tokensPerSecond != null) && (
        <section>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Timing
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {timing?.totalStreamTime != null && (
              <>
                <span className="text-muted-foreground">Duration</span>
                <span className="font-mono tabular-nums text-right">
                  {formatDuration(timing.totalStreamTime)}
                </span>
              </>
            )}
            {timing?.tokensPerSecond != null && (
              <>
                <span className="text-muted-foreground">Throughput</span>
                <span className="font-mono tabular-nums text-right">
                  {timing.tokensPerSecond.toFixed(1)} tok/s
                </span>
              </>
            )}
            {toolCount > 0 && (
              <>
                <span className="text-muted-foreground">Tool calls</span>
                <span className="font-mono tabular-nums text-right">
                  {toolCount}
                </span>
              </>
            )}
          </div>
        </section>
      )}

      {/* Model info */}
      {(displayModel ?? usage?.provider) && (
        <section>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Model
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {usage?.provider && (
              <>
                <span className="text-muted-foreground">Provider</span>
                <span className="font-mono text-right text-xs">
                  {usage.provider}
                </span>
              </>
            )}
            {requestedModel && (
              <>
                <span className="text-muted-foreground">
                  {isResolved ? 'Requested' : 'Model'}
                </span>
                <span className="font-mono text-right text-xs break-all">
                  {requestedModel}
                </span>
              </>
            )}
            {isResolved && displayModel && (
              <>
                <span className="text-muted-foreground">Resolved</span>
                <span className="font-mono text-right text-xs break-all">
                  {displayModel}
                </span>
              </>
            )}
            {usage?.estimatedCostUsd != null && (
              <>
                <span className="text-muted-foreground">Est. cost</span>
                <span className="font-mono tabular-nums text-right">
                  {usage.estimatedCostUsd === 0
                    ? 'free'
                    : `$${usage.estimatedCostUsd.toFixed(4)}`}
                </span>
              </>
            )}
          </div>
        </section>
      )}

      {/* Timestamp */}
      {createdAt instanceof Date && (
        <section>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Time
          </p>
          <span className="text-sm">{formatAbsolute(createdAt)}</span>
        </section>
      )}
    </div>
  )
}

/**
 * Per-message stats footer — compact inline icon row with a "details" button
 * that opens a Dialog showing the full breakdown.
 * Only renders when there is something meaningful to show.
 */
export function MessageStatsFooter() {
  const timing = useMessageTiming()
  const metadata = useMessage((msg) => msg.metadata)
  const createdAt = useMessage((msg) => msg.createdAt)
  // While the message is still streaming, its relative timestamp only ever reads
  // "just now" — noisy next to the starting spinner. Hide it until completion.
  const isRunning = useMessage((msg) => msg.status?.type === 'running')
  // assistant-ui exposes the AI SDK parts array as `message.content`
  const content = useMessage((msg) => msg.content) as readonly unknown[]

  // Extract data-usage part from content (same shape as UIMessage.parts)
  // extractMessageUsage expects { parts: ... } but assistant-ui uses { content: ... }
  const usage = extractMessageUsage({ parts: content } as Parameters<
    typeof extractMessageUsage
  >[0])

  // Fall back to summing step-level usage when data-usage is absent
  const steps = metadata?.steps as
    | { usage?: { inputTokens?: number; outputTokens?: number } }[]
    | undefined
  let inputTokens = usage?.totalInputTokens ?? 0
  let outputTokens = usage?.totalOutputTokens ?? 0
  if (!usage && steps && steps.length > 0) {
    for (const step of steps) {
      inputTokens += step.usage?.inputTokens ?? 0
      outputTokens += step.usage?.outputTokens ?? 0
    }
  }
  const totalTokens = inputTokens + outputTokens

  const toolCount =
    (content as { type?: string }[])?.filter(
      (p) => p?.type === 'tool-call' || (p?.type?.startsWith('tool-') ?? false)
    ).length ?? 0

  const hasTokens = totalTokens > 0
  const hasDuration = timing?.totalStreamTime != null
  const hasTimestamp = createdAt instanceof Date && !isRunning
  const hasModel = (usage?.resolvedModel ?? usage?.model) != null

  if (!hasTokens && !hasDuration && !hasTimestamp) return null

  // The model to show inline — prefer resolvedModel when it differs
  const displayModel = usage?.resolvedModel ?? usage?.model
  const isResolved =
    usage?.resolvedModel != null && usage.resolvedModel !== usage?.model

  return (
    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
      {/* Duration */}
      {hasDuration && timing?.totalStreamTime != null && (
        <span className="flex items-center gap-0.5">
          <ClockIcon className="size-3 shrink-0" />
          <span className="font-mono tabular-nums">
            {formatDuration(timing.totalStreamTime)}
          </span>
        </span>
      )}

      {/* Throughput */}
      {timing?.tokensPerSecond != null && (
        <span className="flex items-center gap-0.5">
          <GaugeIcon className="size-3 shrink-0" />
          <span className="font-mono tabular-nums">
            {timing.tokensPerSecond.toFixed(1)}
          </span>
        </span>
      )}

      {/* Token total */}
      {hasTokens && (
        <span className="flex items-center gap-0.5">
          <CpuIcon className="size-3 shrink-0" />
          <span className="font-mono tabular-nums">
            {totalTokens.toLocaleString()}
          </span>
        </span>
      )}

      {/* Tool call count */}
      {toolCount > 0 && (
        <span className="flex items-center gap-0.5">
          <WrenchIcon className="size-3 shrink-0" />
          <span className="font-mono tabular-nums">{toolCount}</span>
        </span>
      )}

      {/* Model — show resolvedModel with badge when it differs from requested */}
      {hasModel && displayModel && (
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate max-w-[14rem]" title={displayModel}>
            {displayModel}
          </span>
          {isResolved && (
            <Badge
              variant="outline"
              className="px-1 py-0 text-[10px] h-4 leading-none border-border/40"
            >
              resolved
            </Badge>
          )}
        </span>
      )}

      {/* Timestamp with tooltip */}
      {hasTimestamp && (
        <Tooltip>
          <TooltipTrigger
            render={<span className="cursor-default tabular-nums" />}
          >
            {formatRelative(createdAt as Date)}
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {formatAbsolute(createdAt as Date)}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Details dialog trigger */}
      {(hasTokens || hasDuration) && (
        <Dialog>
          <DialogTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-0.5 hover:text-foreground transition-colors"
                aria-label="View response details"
              />
            }
          >
            <InfoIcon className="size-3 shrink-0" />
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Response details</DialogTitle>
            </DialogHeader>
            <MessageStatsDialog
              timing={timing}
              usage={usage}
              steps={steps ?? null}
              createdAt={createdAt instanceof Date ? createdAt : undefined}
              toolCount={toolCount}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
