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

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PencilIcon,
  RefreshCwIcon,
} from 'lucide-react'

import {
  groupByChainOfThought,
  renderGroupedPart,
} from './-thread/chain-of-thought'
import { ThreadComposer, WelcomeComposer } from './-thread/composer'
import { FollowUpChips } from './-thread/follow-up-chips'
import { FollowUpSuggestions } from './-thread/follow-up-suggestions'
import { MessageStatsFooter } from './-thread/message-stats'
import { SessionStats } from './-thread/session-stats'
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
  useThread,
  useThreadRuntime,
} from '@assistant-ui/react'
import { type ComponentProps, type FC, useCallback } from 'react'
import { AgentWelcomeScreen } from '@/components/agents/welcome/agent-welcome-screen'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { JsonRenderMessage } from '@/components/assistant-ui/json-render-message'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import {
  type AgentError,
  extractAgentErrorFromParts,
} from '@/lib/ai/agent/errors'
import { getFollowUpPrompts } from '@/lib/ai/agent/follow-up-prompts'
import { resolveConversationBackend } from '@/lib/conversation-store/adapter/resolve-thread-list-adapter'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'
import { track } from '@/lib/telemetry'

interface ThreadProps {
  /** Display name to weave into the welcome heading. */
  firstName?: string | null
  /** Cluster the agent is wired into (shown in the greeting + footer). */
  clusterName?: string | null
  /** When true, the greeting switches to its alert variant. */
  hasClusterIssue?: boolean
}

export function Thread({
  firstName,
  clusterName,
  hasClusterIssue,
}: ThreadProps = {}) {
  return (
    <ThreadPrimitive.Root
      className="aui-root flex h-full flex-col overflow-hidden bg-background"
      style={{
        // Assistant responses (charts, tables, SQL) use the full container width.
        ['--assistant-max-width' as string]: '100%',
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

            {/* Composer + disclaimer pinned below the scroll area. */}
            <div className="mx-auto flex w-full flex-col items-start gap-2 bg-background px-4 pb-3">
              <FollowUpSuggestions />
              <ThreadComposer />
              <SessionStats />
              <p className="text-muted-foreground text-[11px] leading-4">
                The agent runs read-only ClickHouse queries. Conversations are
                saved{' '}
                {resolveConversationBackend() === 'd1'
                  ? 'to your account'
                  : 'in this browser'}
                .
              </p>
            </div>
          </div>
        </MessageScrollerProvider>
      </ThreadPrimitive.If>
    </ThreadPrimitive.Root>
  )
}

interface ThreadWelcomeProps {
  firstName?: string | null
  clusterName?: string | null
  hasClusterIssue?: boolean
}

function ThreadWelcome({
  firstName,
  clusterName,
  hasClusterIssue,
}: ThreadWelcomeProps) {
  const { activeToolCount } = useAgentSkills()
  const threadRuntime = useThreadRuntime()
  const { ensureAuthed } = useAgentAuthGate()

  const handlePickPrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed) return
      if (!ensureAuthed()) return
      threadRuntime.append({
        role: 'user',
        content: [{ type: 'text', text: trimmed }],
      })
      track('ai_query_sent')
    },
    [threadRuntime, ensureAuthed]
  )

  return (
    <ThreadPrimitive.Empty>
      <AgentWelcomeScreen
        firstName={firstName}
        clusterName={clusterName}
        hasClusterIssue={hasClusterIssue}
        activeToolCount={activeToolCount}
        composer={<WelcomeComposer />}
        onPickPrompt={handlePickPrompt}
      />
    </ThreadPrimitive.Empty>
  )
}

const UserMessage: FC = () => {
  const messageId = useMessage((m) => m.id)
  return (
    // scrollAnchor: a new user turn settles near the top of the viewport
    // (rather than the thread snapping to the document bottom).
    <MessageScrollerItem messageId={messageId} scrollAnchor className="w-full">
      <MessagePrimitive.Root className="w-full py-3">
        <Message align="end">
          <MessageContent className="items-end">
            <UserActionBar />
            <Bubble variant="secondary" align="end">
              <BubbleContent className="break-words text-sm">
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

function UserActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="text-muted-foreground">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="bg-muted mx-auto my-2 flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 rounded-2xl p-3">
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

// ---------------------------------------------------------------------------
// Task #1: "Thinking…" loading placeholder
// ---------------------------------------------------------------------------

/**
 * Shows a subtle spinner while the thread is running and the current assistant
 * message has no real parts yet. The visible "Thinking…" label is intentionally
 * dropped for a cleaner starting state; the text is kept screen-reader-only.
 */
function LoadingIndicator() {
  const isRunning = useThread((thread) => thread.isRunning)
  const hasError = useMessage(
    (msg) =>
      msg.role === 'assistant' &&
      (msg.status?.type === 'incomplete' ||
        msg.content.some(
          (p) => (p as { type?: string })?.type === 'data-error'
        ))
  )
  const hasNoParts = useMessage(
    (msg) =>
      msg.role === 'assistant' &&
      (msg.content.length === 0 ||
        (msg.content.length === 1 &&
          msg.content[0]?.type === 'text' &&
          (msg.content[0] as { type: 'text'; text: string }).text === ''))
  )

  if (!isRunning || hasError || !hasNoParts) return null

  return (
    <Marker className="py-1" role="status">
      <MarkerIcon>
        <LoaderCircleIcon className="animate-spin" />
      </MarkerIcon>
      <span className="sr-only">Thinking…</span>
    </Marker>
  )
}

// ---------------------------------------------------------------------------
// Task #5: MessageError using ErrorPrimitive
// ---------------------------------------------------------------------------

function MessageError() {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive mt-1 rounded-lg border px-3 py-2 text-sm"
      >
        <ErrorPrimitive.Message className="line-clamp-4" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

/**
 * Renders a `data-error` part the agent route streamed for a failure that
 * happened INSIDE the UI-message stream (provider/tool/upstream error surfacing
 * after the HTTP 200 headers were sent). assistant-ui's `MessagePrimitive.Error`
 * only covers the runtime's own error status, so without this these classified
 * errors were dropped and the message looked dead ("An error occurred" / an
 * empty bubble). This makes the real cause + actionable suggestion visible.
 */
function AgentDataError() {
  const content = useMessage((m) => m.content) as readonly unknown[]
  const agentError: AgentError | null = extractAgentErrorFromParts(content)
  if (!agentError) return null

  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive mt-1 rounded-lg border px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium break-words">{agentError.message}</p>
          {agentError.suggestion && (
            <p className="text-destructive/80 text-xs break-words">
              {agentError.suggestion}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AssistantMessage — wires all tasks together
// ---------------------------------------------------------------------------

/**
 * Assistant message body. Renders streaming parts (text · reasoning · tool
 * calls) full-width without an "Agent" avatar — the column already aligns left
 * while user messages align right, so the chrome stays minimal.
 */
const AssistantMessage: FC = () => {
  const messageId = useMessage((m) => m.id)
  return (
    <MessageScrollerItem messageId={messageId} className="w-full">
      <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--assistant-max-width)] py-3">
        <Message align="start">
          <MessageContent className="text-foreground w-full max-w-full gap-1.5">
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

            <div className="flex items-center gap-1">
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

/** Joins the text parts of a message's `content`/parts array into one string. */
function messagePartsText(parts: readonly unknown[]): string {
  return (parts as { type?: string; text?: string }[])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
}

/**
 * Deterministic follow-up chips (issue #2324) — rendered only under the last
 * assistant message, once it has finished streaming. Unlike
 * `FollowUpSuggestions` (LLM-generated, AgentState-only), these are computed
 * instantly client-side from the last exchange via
 * `lib/ai/agent/follow-up-prompts.ts`, so they work for every conversation
 * backend.
 */
function AssistantFollowUpChips() {
  const isLast = useMessage((m) => m.isLast)
  const isRunning = useMessage((m) => m.status?.type === 'running')
  // assistant-ui exposes the AI SDK parts array as `message.content`
  // (same pattern as MessageStatsFooter above).
  const content = useMessage((m) => m.content) as readonly unknown[]
  const messages = useThread((t) => t.messages)
  const threadRuntime = useThreadRuntime()
  const { ensureAuthed } = useAgentAuthGate()

  if (!isLast || isRunning) return null

  const lastAssistantText = messagePartsText(content)

  const toolsUsed = (content as { type?: string; toolName?: string }[])
    .filter((part) => part?.type === 'tool-call')
    .map((part) => part.toolName)
    .filter((name): name is string => Boolean(name))

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  const lastUserText = messagePartsText(
    (lastUserMessage?.content ?? []) as readonly unknown[]
  )

  const prompts = getFollowUpPrompts({
    lastUserText,
    lastAssistantText,
    toolsUsed,
  })

  const handleSelect = (text: string) => {
    if (!ensureAuthed()) return
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
    })
    track('ai_query_sent')
  }

  return (
    <FollowUpChips prompts={prompts} onSelect={handleSelect} className="mt-1" />
  )
}

function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="text-muted-foreground flex items-center gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon className="size-3.5" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon className="size-3.5" />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  )
}

function BranchPicker() {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="text-muted-foreground inline-flex items-center gap-1 text-xs"
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon className="size-3.5" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-mono tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon className="size-3.5" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
