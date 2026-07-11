'use client'

/**
 * Composers for the agent thread: the welcome-screen card (mentions textarea +
 * toolbar with model · skills · tools · add-context) and the in-thread composer
 * docked at the bottom of the viewport. Both share the same submission wiring
 * (auth gate → append user message → cancel-on-stop). Extracted from
 * `thread.tsx`.
 */

import { useThread, useThreadRuntime } from '@assistant-ui/react'
import { useState } from 'react'
import { PromptInputTextareaWithMentions } from '@/components/agents/mentions'
import {
  type ContextItem,
  formatContextBlock,
} from '@/components/agents/welcome/add-context-dialog'
import { ComposerToolbar } from '@/components/agents/welcome/composer-toolbar'
import { PageContextChip } from '@/components/assistant-ui/-thread/page-context-chip'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { track } from '@/lib/telemetry'

/**
 * Welcome-screen composer card: mentions textarea + toolbar (model · skills ·
 * tools · add-context). Wraps the same submission wiring as the in-thread
 * composer below.
 */
export function WelcomeComposer() {
  const threadRuntime = useThreadRuntime()
  const isRunning = useThread((thread) => thread.isRunning)
  const { ensureAuthed } = useAgentAuthGate()
  const [contextItems, setContextItems] = useState<ContextItem[]>([])

  return (
    <div className="flex flex-col gap-2">
      <PageContextChip className="self-start" />
      <PromptInputTextareaWithMentions
        isLoading={isRunning}
        onResolvedSubmit={(text) => {
          const trimmed = text.trim()
          if (!trimmed) return
          if (!ensureAuthed()) return
          const block = formatContextBlock(contextItems)
          const full = block ? `${block}\n\n${trimmed}` : trimmed
          threadRuntime.append({
            role: 'user',
            content: [{ type: 'text', text: full }],
          })
          track('ai_query_sent')
          setContextItems([])
        }}
        onStop={() => threadRuntime.cancelRun()}
      />
      <ComposerToolbar
        contextItems={contextItems}
        onAddContext={(item) => setContextItems((prev) => [...prev, item])}
        onRemoveContext={(id) =>
          setContextItems((prev) => prev.filter((i) => i.id !== id))
        }
      />
    </div>
  )
}

export function ThreadComposer() {
  const threadRuntime = useThreadRuntime()
  const isRunning = useThread((thread) => thread.isRunning)
  const { ensureAuthed } = useAgentAuthGate()

  return (
    <div className="flex w-full flex-col gap-1.5">
      <PageContextChip className="self-start" />
      <PromptInputTextareaWithMentions
        isLoading={isRunning}
        onResolvedSubmit={(text) => {
          const trimmed = text.trim()
          if (!trimmed) return
          if (!ensureAuthed()) return
          threadRuntime.append({
            role: 'user',
            content: [{ type: 'text', text: trimmed }],
          })
          track('ai_query_sent')
        }}
        onStop={() => threadRuntime.cancelRun()}
      />
    </div>
  )
}
