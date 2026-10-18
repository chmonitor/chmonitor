'use client'

/**
 * AgentWelcomeScreen — chat-first welcome screen for the AI Agent page.
 *
 * Centred layout: sparkle icon + dynamic greeting, composer (assistant-ui
 * suggestion-friendly), and a skills capability grid.
 *
 * The composer itself is still rendered by `thread.tsx` (so we don't
 * duplicate runtime wiring); this component is the surrounding shell.
 */

import type { ReactNode } from 'react'

import { SuggestedPrompts } from '@/components/agents/welcome/suggested-prompts-view'
import { ADD_CONNECTION_VIEW } from '@/components/assistant-ui/-thread/agent-connection-error'
import { AgentConnectionErrorNotice } from '@/components/assistant-ui/-thread/agent-connection-error-notice'
import { AgentGreetingIllustration } from '@/components/illustrations/agent-greeting-illustration'
import { useAgentGreeting } from '@/lib/hooks/use-agent-greeting'

interface AgentWelcomeScreenProps {
  firstName?: string | null
  clusterName?: string | null
  hasClusterIssue?: boolean
  composer: ReactNode
  activeToolCount: number
  onPickPrompt?: (prompt: string) => void
  /**
   * Signed-in cloud user with no connection of their own: show the
   * add-connection prompt instead of a composer whose message would be refused.
   */
  needsConnection?: boolean
}

export function AgentWelcomeScreen({
  needsConnection = false,
  firstName,
  clusterName,
  hasClusterIssue,
  composer,
  activeToolCount,
  onPickPrompt,
}: AgentWelcomeScreenProps) {
  const greeting = useAgentGreeting({
    firstName,
    hasClusterIssue,
    clusterName,
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-10 pb-6">
      <div className="mb-8 text-center">
        <AgentGreetingIllustration className="mx-auto mb-3" />
        <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight text-foreground">
          {greeting.heading}
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-[13px] leading-relaxed">
          Wired into{' '}
          <span className="text-foreground/80 font-mono text-[12.5px]">
            {clusterName ?? 'unknown'}
          </span>
          . Ask anything: schemas, queries, performance, health.
        </p>
      </div>

      <div className="mb-8">
        {needsConnection ? (
          <AgentConnectionErrorNotice view={ADD_CONNECTION_VIEW} />
        ) : (
          composer
        )}
      </div>

      {needsConnection ? null : (
        <SuggestedPrompts
          variant="grid"
          onPickPrompt={onPickPrompt}
          limit={6}
        />
      )}

      <div className="text-muted-foreground mt-4 flex items-center justify-center gap-2 text-center text-[11px] tracking-[0.02em]">
        <span className="size-1.5 rounded-full bg-[var(--chart-green)] animate-pulse motion-reduce:animate-none" />
        Connected to{' '}
        <span className="text-foreground font-mono">
          {clusterName ?? 'cluster'}
        </span>{' '}
        · {activeToolCount} tools active · messages saved locally
      </div>
    </div>
  )
}
