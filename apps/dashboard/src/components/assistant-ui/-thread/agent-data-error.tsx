'use client'

import { AgentErrorAlert } from './agent-error-alert'
import { useAuiState } from '@assistant-ui/react'
import {
  type AgentError,
  extractAgentErrorFromParts,
} from '@/lib/ai/agent/errors'

/**
 * Renders a `data-error` part streamed for a failure INSIDE the UI-message
 * stream (after the HTTP 200 headers were sent). assistant-ui's
 * `MessagePrimitive.Error` only covers the runtime's own error status, so
 * without this the message would look dead.
 */
export function AgentDataError() {
  const content = useAuiState((s) => s.message.content) as readonly unknown[]
  const agentError: AgentError | null = extractAgentErrorFromParts(content)
  if (!agentError) return null
  return <AgentErrorAlert agentError={agentError} />
}
