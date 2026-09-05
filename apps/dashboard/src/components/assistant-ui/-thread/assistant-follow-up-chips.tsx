'use client'

import { FollowUpChips } from './follow-up-chips'
import { messagePartsText } from './message-parts-text'
import { useAui, useAuiState } from '@assistant-ui/react'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { getFollowUpPrompts } from '@/lib/ai/agent/follow-up-prompts'
import { track } from '@/lib/telemetry'

/**
 * Deterministic follow-up chips (issue #2324) — rendered only under the last
 * assistant message, once it has finished streaming. Unlike
 * `FollowUpSuggestions` (LLM-generated, AgentState-only), these are computed
 * instantly client-side from the last exchange via
 * `lib/ai/agent/follow-up-prompts.ts`, so they work for every conversation
 * backend.
 */
export function AssistantFollowUpChips() {
  const isLast = useAuiState((s) => s.message.isLast)
  const isRunning = useAuiState((s) => s.message.status?.type === 'running')
  // assistant-ui exposes the AI SDK parts array as `message.content`
  // (same pattern as MessageStatsFooter above).
  const content = useAuiState((s) => s.message.content) as readonly unknown[]
  const messages = useAuiState((s) => s.thread.messages)
  const aui = useAui()
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
    aui.thread.append({
      role: 'user',
      content: [{ type: 'text', text }],
    })
    track('ai_query_sent')
  }

  return (
    <FollowUpChips
      prompts={prompts}
      onSelect={handleSelect}
      anchored
      className="mt-2"
    />
  )
}
