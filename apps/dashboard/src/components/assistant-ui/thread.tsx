'use client'

'use no memo'

/**
 * assistant-ui Thread for the ClickHouse agent.
 *
 * assistant-ui runtime primitives own message data + streaming; the shadcn
 * Base UI chat layer (`components/ui/message`, `bubble`, `message-scroller`)
 * owns presentation and scrolling. Each rendered message wraps itself in a
 * `MessageScrollerItem` keyed by its runtime id so the scroller can anchor it.
 *
 * Project-specific pieces live in `./-thread/*`.
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
  firstName?: string | null
  clusterName?: string | null
  hasClusterIssue?: boolean
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
        // Readable measure; charts/tables/SQL still fill this column.
        ['--assistant-max-width' as string]: 'min(100%, 64rem)',
      }}
    >
      {/* Outside the scroll container so the tall welcome screen starts at the top. */}
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

const AssistantMessage: FC = () => {
  const messageId = useAuiState((s) => s.message.id)
  return (
    <MessageScrollerItem messageId={messageId} className="w-full">
      <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--assistant-max-width)] py-3">
        <Message align="start">
          <MessageContent className="w-full max-w-full gap-1 text-foreground">
            <LoadingIndicator />

            <MessagePrimitive.GroupedParts groupBy={groupByChainOfThought}>
              {
                // The local GroupedRenderInfo is a structural approximation of
                // the library's RenderInfo<ChainOfThoughtKey>; cast to the exact
                // children signature the component expects.
                renderGroupedPart as ComponentProps<
                  typeof MessagePrimitive.GroupedParts
                >['children']
              }
            </MessagePrimitive.GroupedParts>

            <JsonRenderMessage />

            <MessageError />

            <AgentDataError />

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 focus-within:opacity-100">
              <BranchPicker />
              <AssistantActionBar />
            </div>

            <MessageStatsFooter />

            <AssistantFollowUpChips />
          </MessageContent>
        </Message>
      </MessagePrimitive.Root>
    </MessageScrollerItem>
  )
}
