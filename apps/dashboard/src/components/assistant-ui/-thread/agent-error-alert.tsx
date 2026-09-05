'use client'

import { AlertTriangleIcon } from 'lucide-react'

import {
  type AgentError,
  classifyError,
  parseAgentError,
} from '@/lib/ai/agent/errors'

/**
 * Render a classified agent error (message + actionable suggestion). Shared by
 * runtime HTTP errors (`MessagePrimitive.Error`) and streamed `data-error` parts.
 */
export function AgentErrorAlert({ agentError }: { agentError: AgentError }) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive mt-1 rounded-lg border px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium break-words">{agentError.message}</p>
          {agentError.suggestion ? (
            <p className="text-destructive/80 text-xs break-words">
              {agentError.suggestion}
            </p>
          ) : null}
          {agentError.code ? (
            <p className="text-destructive/60 font-mono text-[10px]">
              {agentError.code}
              {agentError.provider ? ` · ${agentError.provider}` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Parse the runtime error payload (often a stringified `{ error: AgentError }`
 * JSON body from the agent route) into a structured alert. Falls back to
 * {@link classifyError} for plain text / non-AgentError shapes so we never dump
 * raw JSON into the chat bubble.
 */
export function resolveRuntimeAgentError(raw: unknown): AgentError {
  if (raw instanceof Error) {
    const parsed = parseAgentError(raw)
    if (parsed) return parsed
    // AI SDK often puts the JSON body in error.message — classify the Error.
    return classifyError(raw)
  }
  if (typeof raw === 'string') {
    const parsed = parseAgentError(new Error(raw))
    if (parsed) return parsed
    return classifyError(raw)
  }
  // Some transports put the parsed JSON body (`{ error: AgentError }`) on
  // status.error directly rather than as a string.
  if (raw && typeof raw === 'object') {
    const asRecord = raw as Record<string, unknown>
    const nested = asRecord.error
    if (
      nested &&
      typeof nested === 'object' &&
      typeof (nested as AgentError).type === 'string' &&
      typeof (nested as AgentError).message === 'string'
    ) {
      const parsed = parseAgentError(
        new Error(JSON.stringify({ error: nested }))
      )
      if (parsed) return parsed
    }
    const direct = parseAgentError(new Error(JSON.stringify(raw)))
    if (direct) return direct
  }
  return classifyError(raw)
}
