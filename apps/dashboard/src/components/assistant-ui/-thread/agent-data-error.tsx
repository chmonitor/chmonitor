'use client'

import { AgentErrorAlert } from './agent-error-alert'
import { useAuiState } from '@assistant-ui/react'
import {
  type AgentError,
  extractAgentErrorFromParts,
} from '@/lib/ai/agent/errors'

/**
 * Renders a `data-error` part the agent route streamed for a failure that
 * happened INSIDE the UI-message stream (provider/tool/upstream error surfacing
 * after the HTTP 200 headers were sent). assistant-ui's `MessagePrimitive.Error`
 * only covers the runtime's own error status, so without this these classified
 * errors were dropped and the message looked dead ("An error occurred" / an
 * empty bubble). This makes the real cause + actionable suggestion visible.
 */
export function AgentDataError() {
  const content = useAuiState((s) => s.message.content) as readonly unknown[]
  const agentError: AgentError | null = extractAgentErrorFromParts(content)
  if (!agentError) return null
  return <AgentErrorAlert agentError={agentError} />
}
