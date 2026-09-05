'use client'

'use no memo'

/**
 * assistant-ui Thread for the ClickHouse agent.
 *
 * Composes the assistant-ui *runtime* primitives (Thread / Message / Composer /
 * ActionBar / BranchPicker — which own message data + streaming) with the
 * shadcn **Base UI** chat presentation layer:
 *  - `components/ui/message`         – Message / MessageContent layout + align
 *  - `components/ui/bubble`          – Bubble / BubbleContent surfaces
 *  - `components/ui/message-scroller`– scroll container that owns stick-to-bottom,
 *    turn anchoring, and the scroll-to-bottom button (replaces assistant-ui's
 *    Viewport + ScrollToBottom). assistant-ui still provides the message list via
 *    `ThreadPrimitive.Messages`; each rendered message wraps itself in a
 *    `MessageScrollerItem` keyed by its runtime id so the scroller can anchor it.
 *
 * Project-specific pieces live in co-located `./-thread/*` modules:
 *  - `composer.tsx`        – welcome + in-thread mention composers
 *  - `chain-of-thought.tsx`– GroupedParts reasoning/tool render pipeline
 *  - `message-stats.tsx`   – per-message stats footer + details dialog
 *  - `format.ts`           – shared duration/date helpers
 *
 * Tasks shipped across this file + its modules:
 *  #1  – Loading indicator right after user submit
 *  #3  – Per-message stats footer (tokens / duration / model / timestamp)
 *  #4  – Chain-of-Thought via MessagePrimitive.GroupedParts
 *  #5  – ErrorPrimitive rendering
 *  #8  – Reasoning ghost/muted styling (via reasoning.tsx)
 *  #11 – ToolGroup component (collapsible adjacent tool calls)
 *  #12 – Message timing (relative timestamp w/ tooltip)
 */

import type { ComponentProps, FC } from 'react'

import { AgentDataError } from './-thread/agent-data-error'
import { AssistantActionBar } from './-thread/assistant-action-bar'
import { AssistantFollowUpChips } from './-thread/assistant-follow-up-chips'
import { BranchPicker } from './-thread/branch-picker'
import {
  groupByChainOfThought,
  renderGroupedPart,
} from './-thread/chain-of-thought'
import { ThreadComposer } from './-thread/composer'
import { FollowUpSuggestions } from './-thread/follow-up-suggestions'
import { LoadingIndicator } from './-thread/loading-indicator'
import { MessageError } from './-thread/message-error'
import { MessageStatsFooter } from './-thread/message-stats'
import { ThreadWelcome } from './-thread/thread-welcome'
import { UserActionBar } from './-thread/user-action-bar'
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react'
import { JsonRenderMessage } from '@/components/assistant-ui/json-render-message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'

interface ThreadProps {
  /** Display name to weave into the welcome heading. */
  firstName?: string | null
  /** Cluster the agent is wired into (shown in the greeting + footer). */
  clusterName?: string | null
  /** When true, the greeting switches to its alert variant. */
  hasClusterIssue?: boolean
  /** Send a suggested question. Parent may collapse chrome first. */
  onPickPrompt?: (prompt: string) => void
}

export function Thread({
  firstName,
  clusterName,
  hasClusterIssue,
  onPickPrompt,
}: ThreadProps = {}) {
  return (
    <ThreadPrimitive.Root
      className="aui-root flex h-full flex-col overflow-hidden bg-background"
      style={{
        // Cap assistant content to a readable measure (~64rem) instead of
        // stretching edge-to-edge; charts/tables/SQL still fill this column
        // and it centers within wider containers (issue #2803).
        ['--assistant-max-width' as string]: 'min(100%, 64rem)',
      }}
    >
      {/* Empty (welcome) state lives OUTSIDE the scroll container. The tall
          welcome screen (composer + suggested questions) should start at the
          top, not be pinned to the bottom by the scroller. */}
      <ThreadPrimitive.If empty>
        <div className="flex flex-1 flex-col overflow-y-auto px-4 pt-14">
          <ThreadWelcome
            firstName={firstName}
            clusterName={clusterName}
            hasClusterIssue={hasClusterIssue}
            onPickPrompt={onPickPrompt}
          />
        </div>
      </ThreadPrimitive.If>

      <ThreadPrimitive.If empty={false}>
        {/* MessageScroller owns scroll: stick-to-bottom while streaming, turn
            anchoring, and the floating scroll-to-bottom button. */}
        <MessageScrollerProvider autoScroll>
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <MessageScroller className="flex flex-1 flex-col overflow-hidden">
              <MessageScrollerViewport className="px-4 pt-14">
                <MessageScrollerContent className="mx-auto w-full gap-1">
                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage,
                      EditComposer,
                      AssistantMessage,
                    }}
                  />
                </MessageScrollerContent>

                <MessageScrollerButton
                  direction="end"
                  className="left-1/2 -translate-x-1/2 rounded-full"
                />
              </MessageScrollerViewport>
            </MessageScroller>

            {/* Composer pinned below the scroll area. */}
            <div className="mx-auto flex w-full flex-col items-start gap-2 bg-background px-4 pb-3">
              <FollowUpSuggestions />
              <ThreadComposer />
            </div>
          </div>
        </MessageScrollerProvider>
      </ThreadPrimitive.If>
    </ThreadPrimitive.Root>
  )
}

const UserMessage: FC = () => {
  const messageId = useAuiState((s) => s.message.id)
  return (
    // scrollAnchor: a new user turn settles near the top of the viewport
    // (rather than the thread snapping to the document bottom).
    <MessageScrollerItem messageId={messageId} scrollAnchor className="w-full">
      <MessagePrimitive.Root className="w-full py-3">
        <Message align="end">
          <MessageContent className="max-w-[min(100%,36rem)] items-end">
            <UserActionBar />
            <Bubble variant="secondary" align="end" className="max-w-full">
              <BubbleContent className="overflow-x-auto whitespace-pre-wrap break-words text-sm">
                <MessagePrimitive.Parts />
              </BubbleContent>
            </Bubble>
            <BranchPicker />
          </MessageContent>
        </Message>
      </MessagePrimitive.Root>
    </MessageScrollerItem>
  )
}

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="mx-auto my-2 flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <ComposerPrimitive.Input
        className="text-foreground min-h-12 w-full resize-none bg-transparent text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
        autoFocus
      />
      <div className="flex items-center justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className="hover:bg-background rounded-md px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs"
          >
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  )
}

/**
 * Assistant message body. Renders streaming parts (text · reasoning · tool
 * calls) full-width without an "Agent" avatar — the column already aligns left
 * while user messages align right, so the chrome stays minimal.
 */
const AssistantMessage: FC = () => {
  const messageId = useAuiState((s) => s.message.id)
  return (
    <MessageScrollerItem messageId={messageId} className="w-full">
      <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--assistant-max-width)] py-3">
        <Message align="start">
          <MessageContent className="w-full max-w-full gap-1 text-foreground">
            {/* Task #1: loading dots while no parts exist yet */}
            <LoadingIndicator />

            {/* Tasks #4, #8, #11: chain-of-thought with reasoning + tool groups */}
            <MessagePrimitive.GroupedParts groupBy={groupByChainOfThought}>
              {
                // The local GroupedRenderInfo is a structural approximation of
                // the library's RenderInfo<ChainOfThoughtKey>; cast to the exact
                // children signature the component expects (same code path as
                // the Next app).
                renderGroupedPart as ComponentProps<
                  typeof MessagePrimitive.GroupedParts
                >['children']
              }
            </MessagePrimitive.GroupedParts>

            <JsonRenderMessage />

            {/* Task #5: error display */}
            <MessageError />

            {/* Surface errors the route streamed as a `data-error` part (a
                failure inside the stream, after HTTP 200) — otherwise the
                message looks dead. */}
            <AgentDataError />

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 focus-within:opacity-100">
              <BranchPicker />
              <AssistantActionBar />
            </div>

            {/* Tasks #3 + #12: per-message stats + timestamp */}
            <MessageStatsFooter />

            {/* Deterministic, rule-based follow-up chips (issue #2324) */}
            <AssistantFollowUpChips />
          </MessageContent>
        </Message>
      </MessagePrimitive.Root>
    </MessageScrollerItem>
  )
}
