'use client'

import { WelcomeComposer } from './composer'
import { ThreadPrimitive } from '@assistant-ui/react'
import { AgentWelcomeScreen } from '@/components/agents/welcome/agent-welcome-screen'
import { useStartAgentPrompt } from '@/components/assistant-ui/use-start-agent-prompt'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'

interface ThreadWelcomeProps {
  firstName?: string | null
  clusterName?: string | null
  hasClusterIssue?: boolean
  onPickPrompt?: (prompt: string) => void
}

export function ThreadWelcome({
  firstName,
  clusterName,
  hasClusterIssue,
  onPickPrompt,
}: ThreadWelcomeProps) {
  const { activeToolCount } = useAgentSkills()
  const startPrompt = useStartAgentPrompt()
  const handlePickPrompt = onPickPrompt ?? startPrompt

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
