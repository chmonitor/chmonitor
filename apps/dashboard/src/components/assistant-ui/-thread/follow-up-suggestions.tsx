'use client'

/**
 * Follow-up suggestions affordance.
 *
 * When the active conversation backend supports AI enrichment (AgentState) and
 * a persisted conversation exists, this renders a small "Suggested follow-ups"
 * control. Suggestions are fetched on demand (not automatically) and rendered
 * as clickable chips (via `FollowUpChips`, shared with the deterministic
 * per-message chips so both affordances read as one visual system); clicking
 * one appends it to the thread as a user message.
 *
 * The component renders nothing unless enrichment is supported and a remote
 * conversation id is available, so it can be dropped into the thread
 * unconditionally. It sits directly above the composer (see `thread.tsx`), so
 * its own top border + padding is what visually anchors it there rather than
 * floating loose above the input.
 */

import { SparklesIcon } from 'lucide-react'

import { FollowUpChips } from './follow-up-chips'
import { useThreadListItem, useThreadRuntime } from '@assistant-ui/react'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { Button } from '@/components/ui/button'
import { useConversationBackend } from '@/lib/hooks/use-conversation-backend'
import { useFollowUps } from '@/lib/hooks/use-follow-ups'
import { track } from '@/lib/telemetry'

export function FollowUpSuggestions() {
  const { supportsAiEnrichment } = useConversationBackend()
  // `remoteId` is the server-side conversation id used by the follow-ups route.
  const conversationId = useThreadListItem((s) => s.remoteId)
  const threadRuntime = useThreadRuntime()
  const { ensureAuthed } = useAgentAuthGate()
  const { questions, fetchFollowUps, isLoading } = useFollowUps(conversationId)

  // Only available with an AI-enriched backend and an active, persisted thread.
  if (!supportsAiEnrichment || !conversationId) return null

  const handlePick = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return
    if (!ensureAuthed()) return
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text: trimmed }],
    })
    track('ai_query_sent')
  }

  return (
    <div className="border-border/60 flex w-full flex-col gap-1.5 border-t pt-2">
      {questions.length === 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void fetchFollowUps()}
          disabled={isLoading}
          className="text-muted-foreground hover:text-foreground h-7 w-fit gap-1.5 px-2 text-[11px]"
        >
          <SparklesIcon className="size-3" />
          {isLoading ? 'Loading suggestions…' : 'Suggested follow-ups'}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
            <SparklesIcon className="size-3" />
            Follow-ups
          </span>
          <FollowUpChips prompts={questions} onSelect={handlePick} />
        </div>
      )}
    </div>
  )
}
