'use client'

import { WelcomeComposer } from './composer'
import { ThreadPrimitive } from '@assistant-ui/react'
import { AgentWelcomeScreen } from '@/components/agents/welcome/agent-welcome-screen'
import { useStartAgentPrompt } from '@/components/assistant-ui/use-start-agent-prompt'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

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
  const { hosts, isLoading, cloudMode, isSignedIn } = useMergedHosts()
  // Cloud hides the demo for signed-in users, so zero hosts means zero own
  // connections: the agent route would refuse the first message.
  const needsConnection =
    cloudMode && isSignedIn && !isLoading && hosts.length === 0

  return (
    <ThreadPrimitive.Empty>
      <AgentWelcomeScreen
        firstName={firstName}
        clusterName={clusterName}
        hasClusterIssue={hasClusterIssue}
        activeToolCount={activeToolCount}
        composer={<WelcomeComposer />}
        onPickPrompt={handlePickPrompt}
        needsConnection={needsConnection}
      />
    </ThreadPrimitive.Empty>
  )
}
