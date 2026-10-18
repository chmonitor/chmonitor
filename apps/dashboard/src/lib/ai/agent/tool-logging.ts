import type { ToolExecutionOptions, ToolSet } from 'ai'

import { log, error as logError } from '@chm/logger'

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'key',
  'auth',
  'authorization',
  'credential',
  'credentials',
])

const MAX_ARG_LOG_LENGTH = 256

function redactArgs(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input

  if (Array.isArray(input)) {
    return input.map(redactArgs)
  }

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      result[k] = '[REDACTED]'
    } else if (typeof v === 'string' && v.length > MAX_ARG_LOG_LENGTH) {
      result[k] = `${v.slice(0, MAX_ARG_LOG_LENGTH)}…`
    } else if (typeof v === 'object' && v !== null) {
      // One level of nesting — keep keys, redact values recursively
      result[k] = redactArgs(v)
    } else {
      result[k] = v
    }
  }
  return result
}

function countResults(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>
    if (Array.isArray(r.data)) return r.data.length
    if (Array.isArray(r.rows)) return r.rows.length
  }
  return undefined
}

function classifyToolError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout'
    if (msg.includes('validation') || msg.includes('invalid'))
      return 'validation'
    if (msg.includes('not found') || msg.includes('does not exist'))
      return 'not_found'
    if (msg.includes('network') || msg.includes('connection')) return 'network'
    return 'error'
  }
  return 'unknown'
}

export function wrapToolsWithLogging<T extends ToolSet>(
  tools: T,
  sessionId: string
): T {
  const wrapped: ToolSet = {}

  for (const [toolName, tool] of Object.entries(tools) as [
    string,
    ToolSet[string],
  ][]) {
    const originalExecute = tool.execute

    if (typeof originalExecute !== 'function') {
      wrapped[toolName] = tool
      continue
    }

    wrapped[toolName] = {
      ...tool,
      execute: async (
        input: unknown,
        options: ToolExecutionOptions<unknown>
      ): Promise<unknown> => {
        const traceId = options?.toolCallId ?? crypto.randomUUID()
        const startMs = Date.now()

        try {
          const result = await originalExecute(input, options)
          const durationMs = Date.now() - startMs
          const resultCount = countResults(result)

          log('[agent:tool] completed', {
            toolName,
            traceId,
            conversationId: sessionId,
            durationMs,
            ...(resultCount !== undefined ? { resultCount } : {}),
            args: redactArgs(input),
          })

          return result
        } catch (err) {
          const durationMs = Date.now() - startMs
          const errorCategory = classifyToolError(err)

          logError('[agent:tool] failed', err, {
            component: 'agent-tool',
            action: toolName,
          })

          log('[agent:tool] execution-error', {
            toolName,
            traceId,
            conversationId: sessionId,
            durationMs,
            errorCategory,
            args: redactArgs(input),
          })

          throw err
        }
      },
    }
  }

  // We've preserved every tool field via spread and only replaced the execute
  // implementation (same signature). The assertion is safe; no `any` is used.
  return wrapped as T
}
