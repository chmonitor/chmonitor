'use client'

/**
 * Composers for the agent thread: the welcome-screen card (mentions textarea +
 * toolbar with model · skills · tools · add-context) and the in-thread composer
 * docked at the bottom of the viewport. Both share the same submission wiring
 * (auth gate → append user message → cancel-on-stop). Extracted from
 * `thread.tsx`.
 */

import { useAui, useAuiState } from '@assistant-ui/react'
import { useState } from 'react'
import { PromptInputTextareaWithMentions } from '@/components/agents/mentions'
import {
  type ContextItem,
  formatContextBlock,
} from '@/components/agents/welcome/add-context-dialog'
import { ComposerToolbar } from '@/components/agents/welcome/composer-toolbar'
import { PageContextChip } from '@/components/assistant-ui/-thread/page-context-chip'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { useAgentModel } from '@/lib/hooks/use-agent-model'
import { track } from '@/lib/telemetry'

/**
 * Welcome-screen composer card: mentions textarea + toolbar (model · skills ·
 * tools · add-context). Wraps the same submission wiring as the in-thread
 * composer below.
 */
export function WelcomeComposer() {
  const aui = useAui()
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const { ensureAuthed } = useAgentAuthGate()
  const { noProvidersConfigured } = useAgentModel()
  const [contextItems, setContextItems] = useState<ContextItem[]>([])

  return (
    <div className="flex flex-col gap-2">
      {noProvidersConfigured ? (
        <div
          role="status"
          className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100 rounded-lg border px-3 py-2 text-sm"
        >
          <p className="font-medium">LLM provider not configured</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Set one of{' '}
            <code className="font-mono text-[11px]">OPENROUTER_API_KEY</code>{' '}
            (or <code className="font-mono text-[11px]">LLM_API_KEY</code>),{' '}
            <code className="font-mono text-[11px]">ANYROUTER_API_KEY</code>, or{' '}
            <code className="font-mono text-[11px]">NVIDIA_API_KEY</code> on
            this deployment so the agent can answer.
          </p>
        </div>
      ) : null}
      <PageContextChip className="self-start" />
      <PromptInputTextareaWithMentions
        isLoading={isRunning}
        onResolvedSubmit={(text) => {
          const trimmed = text.trim()
          if (!trimmed) return
          if (noProvidersConfigured) return
          if (!ensureAuthed()) return
          const block = formatContextBlock(contextItems)
          const full = block ? `${block}\n\n${trimmed}` : trimmed
          aui.thread.append({
            role: 'user',
            content: [{ type: 'text', text: full }],
          })
          track('ai_query_sent')
          setContextItems([])
        }}
        onStop={() => aui.thread.cancelRun()}
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
  const aui = useAui()
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const { ensureAuthed } = useAgentAuthGate()
  const { noProvidersConfigured } = useAgentModel()
  const [contextItems, setContextItems] = useState<ContextItem[]>([])

  return (
    <div className="flex w-full flex-col gap-1.5">
      {noProvidersConfigured ? (
        <div
          role="status"
          className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100 rounded-lg border px-3 py-2 text-sm"
        >
          <p className="font-medium">LLM provider not configured</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Set OPENROUTER_API_KEY (or LLM_API_KEY), ANYROUTER_API_KEY, or
            NVIDIA_API_KEY so the agent can answer.
          </p>
        </div>
      ) : null}
      <PageContextChip className="self-start" />
      <PromptInputTextareaWithMentions
        isLoading={isRunning}
        onResolvedSubmit={(text) => {
          const trimmed = text.trim()
          if (!trimmed) return
          if (noProvidersConfigured) return
          if (!ensureAuthed()) return
          const block = formatContextBlock(contextItems)
          const full = block ? `${block}\n\n${trimmed}` : trimmed
          aui.thread.append({
            role: 'user',
            content: [{ type: 'text', text: full }],
          })
          track('ai_query_sent')
          setContextItems([])
        }}
        onStop={() => aui.thread.cancelRun()}
      />
      {/* Keep the toolbar (model · skills · tools · add-context) available
          mid-conversation, not just on the welcome screen (issue #2804). */}
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
