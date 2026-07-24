'use client'

/**
 * Chain-of-Thought rendering pipeline for assistant messages
 * (Tasks #4 / #8 / #11).
 *
 * `groupByChainOfThought` is the stable module-level groupBy passed to
 * `MessagePrimitive.GroupedParts`; `renderGroupedPart` turns each group/leaf
 * node into UI. Reasoning and tool-call runs are rendered as SEPARATE sibling
 * blocks (tools are NOT nested under reasoning). Adjacent same-type parts
 * coalesce into one local run, so each tool block counts only the tools in
 * THAT run — not the whole message.
 */

import type {
  EnrichedPartState,
  MessagePartStatus,
  PartState,
  ToolCallMessagePartStatus,
} from '@assistant-ui/react'
import type { ReactNode } from 'react'

import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from '@/components/assistant-ui/reasoning'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from '@/components/assistant-ui/tool-group'

// ---------------------------------------------------------------------------
// GroupedParts groupBy — module-level stable reference
// ---------------------------------------------------------------------------

// Type alias for the group key union used in GroupedParts
type ChainOfThoughtKey = 'group-reasoning' | 'group-tool'

/**
 * Groups adjacent reasoning parts into a `group-reasoning` run and adjacent
 * tool-call parts into a `group-tool` run, as SEPARATE top-level siblings.
 * A text part between two runs breaks the run, so counts stay local. Text
 * parts are left ungrouped (rendered as leaves).
 *
 * Plain module-level stable reference — required for GroupedParts performance.
 * Intentionally NOT `groupPartByType`: the Cloudflare build replaces
 * `@assistant-ui/react` with a client-only SSR stub whose fixed export list
 * does not include `groupPartByType`, so importing it breaks the CF build.
 */
export const groupByChainOfThought = (
  part: PartState
): readonly ChainOfThoughtKey[] | null => {
  if (part.type === 'reasoning') return ['group-reasoning'] as const
  if (part.type === 'tool-call') return ['group-tool'] as const
  return null
}

/** Shape of each group/leaf node delivered by MessagePrimitive.GroupedParts */
type GroupedRenderInfo = {
  readonly part:
    | {
        readonly type: ChainOfThoughtKey
        readonly status: MessagePartStatus | ToolCallMessagePartStatus
        readonly indices: readonly number[]
      }
    | EnrichedPartState
  readonly children: ReactNode
}

// ---------------------------------------------------------------------------
// Leaf part renderers
// ---------------------------------------------------------------------------

/**
 * Renders an enriched leaf part (text, reasoning, tool-call, etc.) inside
 * GroupedParts. For tool-calls we use the full ToolFallback renderer.
 */
function renderLeafPart(part: EnrichedPartState) {
  switch (part.type) {
    case 'text': {
      // Synthetic empty-text loading part: skip (handled by LoadingIndicator)
      if (part.text === '' && part.status?.type === 'running') return null
      return <MarkdownText {...part} />
    }
    case 'reasoning': {
      const isActive = part.status?.type === 'running'
      // The group-reasoning branch already renders the ReasoningRoot +
      // ReasoningTrigger ("Thought process") shell; here we render only the
      // inner text so the trigger is not duplicated.
      return (
        <ReasoningContent>
          <ReasoningText
            text={part.text ?? ''}
            className={isActive ? 'opacity-70' : undefined}
          />
        </ReasoningContent>
      )
    }
    case 'tool-call': {
      if (part.toolUI) return <>{part.toolUI}</>
      // Spread all ToolCallMessagePart fields + addResult + resume
      return <ToolFallback {...part} />
    }
    default:
      return null
  }
}

/**
 * Renders a run of adjacent tool calls as sibling leaf rows — one foldable
 * row per tool (the ToolFallback/tool-output row owns its own expand state),
 * NOT a single outer "N tool calls" group that forces two folds to reach
 * any tool's content.
 */

/**
 * Renderer function for MessagePrimitive.GroupedParts.
 * Reasoning and tool runs render as separate sibling collapsibles whose open
 * state follows the run's `running` status; leaf parts delegate to
 * renderLeafPart().
 */
export function renderGroupedPart({ part, children }: GroupedRenderInfo) {
  switch (part.type) {
    case 'group-reasoning': {
      const isRunning = part.status?.type === 'running'
      return (
        <ReasoningRoot isRunning={isRunning}>
          <ReasoningTrigger active={isRunning} />
          <ReasoningContent>{children}</ReasoningContent>
        </ReasoningRoot>
      )
    }
    case 'group-tool': {
      // Collapse a run of adjacent tool calls into ONE "N tool calls"
      // disclosure (issue #2803). While the run streams it auto-expands; once
      // finished it collapses into tidy history. A single tool call needs no
      // outer group — render it as a bare sibling row.
      const count = 'indices' in part ? part.indices.length : 0
      const isRunning = part.status?.type === 'running'
      if (count <= 1) return <>{children}</>
      return (
        <ToolGroupRoot isRunning={isRunning}>
          <ToolGroupTrigger count={count} status={part.status} />
          <ToolGroupContent>{children}</ToolGroupContent>
        </ToolGroupRoot>
      )
    }
    default: {
      // Leaf part — cast is safe: non-group parts are EnrichedPartState
      return renderLeafPart(part as EnrichedPartState)
    }
  }
}
