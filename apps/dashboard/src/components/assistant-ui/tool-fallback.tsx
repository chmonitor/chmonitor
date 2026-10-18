'use client'

import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { useAuiState } from '@assistant-ui/react'
import {
  type AgentToolPart,
  ToolCallPart,
} from '@/components/agents/chat/tool-output'

/**
 * Registered as `tools.Fallback` on `MessagePrimitive.Parts`, so every tool
 * call, whatever its name, renders through `ToolCallPart`.
 */
export const ToolFallback: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  argsText,
  result,
  isError,
  status,
  addResult,
}) => {
  const hasResult = result !== undefined && result !== null
  const isRunning = status?.type === 'running'
  // Whether the whole assistant turn is still streaming (NOT just this tool).
  // Drives the row's collapse-into-history so it waits for the final text.
  const isMessageStreaming = useAuiState(
    (s) => s.message.status?.type === 'running'
  )

  const state: AgentToolPart['state'] = isError
    ? 'output-error'
    : hasResult
      ? 'output-available'
      : isRunning
        ? 'output-streaming'
        : 'input-available'

  const part: AgentToolPart = {
    type: `tool-${toolName ?? 'unknown'}`,
    toolCallId,
    toolName: toolName ?? 'tool',
    state,
    input: args ?? (argsText ? safeParse(argsText) : undefined),
    output: result,
    errorText: isError
      ? typeof result === 'string'
        ? result
        : JSON.stringify(result)
      : undefined,
  }

  return (
    <ToolCallPart
      part={part}
      isMessageStreaming={isMessageStreaming}
      onToolResult={(_toolCallId, value) => addResult(value)}
    />
  )
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
