'use client'

import { AgentErrorAlert, resolveRuntimeAgentError } from './agent-error-alert'
import { MessagePrimitive, useAuiState } from '@assistant-ui/react'

export function MessageError() {
  const status = useAuiState((s) => s.message.status)
  const rawError =
    status &&
    typeof status === 'object' &&
    'error' in status &&
    (status as { error?: unknown }).error !== undefined &&
    (status as { error?: unknown }).error !== null
      ? (status as { error?: unknown }).error
      : undefined

  // MessagePrimitive.Error only mounts when the runtime marked the message as
  // failed; parse any JSON body so we never dump raw `{error:{...}}` into the UI.
  const agentError = resolveRuntimeAgentError(
    rawError ?? 'An unexpected error occurred'
  )

  return (
    <MessagePrimitive.Error>
      <AgentErrorAlert agentError={agentError} />
    </MessagePrimitive.Error>
  )
}
