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
import { useAgentModel } from '@/lib/hooks/use-agent-model'
import { track } from '@/lib/telemetry'
import { cn } from '@/lib/utils'

/**
 * Compact keyboard-hint row shown under the composer in both the welcome and
 * in-thread positions (issue #2804).
 */
function ComposerHints({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground',
        className
      )}
    >
      <span className="flex items-center gap-1">
        <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-sans text-[10px] font-medium">
          Enter
        </kbd>
        send
      </span>
      <span className="flex items-center gap-1">
        <kbd className="inline-flex h-4 items-center justify-center rounded border bg-muted px-1 font-sans text-[10px] font-medium">
          Shift+Enter
        </kbd>
        newline
      </span>
      <span className="flex items-center gap-1">
        <kbd className="inline-flex h-4 items-center justify-center rounded border bg-muted px-1 font-sans text-[10px] font-medium">
          ⌘K
        </kbd>
        new chat
      </span>
    </div>
  )
}

/**
 * Welcome-screen composer card: mentions textarea + toolbar (model · skills ·
 * tools · add-context). Wraps the same submission wiring as the in-thread
 * composer below.
 */
export function WelcomeComposer() {
  const threadRuntime = useThreadRuntime()
  const isRunning = useThread((thread) => thread.isRunning)
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
            <code className="font-mono text-[11px]">NVIDIA_API_KEY</code> on this
            deployment so the agent can answer.
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
      <ComposerHints />
    </div>
  )
}

export function ThreadComposer() {
  const threadRuntime = useThreadRuntime()
  const isRunning = useThread((thread) => thread.isRunning)
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
          threadRuntime.append({
            role: 'user',
            content: [{ type: 'text', text: full }],
          })
          track('ai_query_sent')
          setContextItems([])
        }}
        onStop={() => threadRuntime.cancelRun()}
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
      <ComposerHints />
    </div>
  )
}
