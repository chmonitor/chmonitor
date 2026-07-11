/**
 * Agent error classification and formatting utilities.
 *
 * Provides structured error types, classification logic, and actionable
 * suggestions to improve the agent error UX.
 */

export type AgentErrorType =
  | 'auth_error' // 401, 403, invalid API key
  | 'rate_limit' // 429, quota exceeded
  | 'model_error' // Model not found, model overloaded
  | 'tool_error' // Tool execution failed
  | 'timeout' // Request/query timeout
  | 'network_error' // Connection refused, DNS failure
  | 'billing_error' // 402, insufficient credits
  | 'upstream_error' // Provider/gateway upstream failure
  | 'unknown' // Fallback

export interface AgentError {
  type: AgentErrorType
  message: string
  details?: string
  suggestion: string
  timestamp: number
  model?: string
  provider?: string
  code?: string
  statusCode?: number
  upstreamBackend?: string
  upstreamStatus?: number
  upstreamMessage?: string
  requestId?: string
}

export interface ClassifyErrorContext {
  readonly model?: string
  readonly provider?: string
}

type ParsedErrorEnvelope = {
  readonly message?: string
  readonly details?: string
  readonly code?: string
  readonly statusCode?: number
  readonly upstreamBackend?: string
  readonly upstreamStatus?: number
  readonly upstreamMessage?: string
  readonly requestId?: string
}

type MutableParsedErrorEnvelope = {
  -readonly [Key in keyof ParsedErrorEnvelope]?: ParsedErrorEnvelope[Key]
}

/**
 * Returns an actionable suggestion string for a given error type.
 */
export function getErrorSuggestion(
  type: AgentErrorType,
  provider?: string
): string {
  switch (type) {
    case 'auth_error':
      return provider === 'anyrouter'
        ? 'Check ANYROUTER_API_KEY or the selected AnyRouter key in .env.local'
        : 'Check OPENROUTER_API_KEY, NVIDIA_API_KEY, ANYROUTER_API_KEY, or LLM_API_KEY in .env.local'
    case 'rate_limit':
      return 'Wait a moment and retry, or switch to a different model'
    case 'billing_error':
      return provider === 'anyrouter'
        ? 'Check AnyRouter credits or upstream BYOK billing for the selected model'
        : 'Add credits to your OpenRouter account'
    case 'model_error':
      return 'Try a different model from the dropdown'
    case 'timeout':
      return 'Simplify your query or increase CLICKHOUSE_MAX_EXECUTION_TIME'
    case 'network_error':
      return 'Check your internet connection and LLM_API_BASE URL'
    case 'tool_error':
      return 'The tool encountered an issue. Try rephrasing your question'
    case 'upstream_error':
      return 'The selected provider could not complete the upstream request. Retry or switch model/provider'
    default:
      return 'An unexpected error occurred. Try again or switch models'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value)
    }
    if (typeof value === 'string' && /^\d{3}$/.test(value)) {
      return Number(value)
    }
  }
  return undefined
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value ?? 'Unknown error')
  }
}

function mergeParsedEnvelopes(
  ...values: ParsedErrorEnvelope[]
): ParsedErrorEnvelope {
  const merged: MutableParsedErrorEnvelope = {}

  for (const value of values) {
    if (value.message !== undefined) merged.message = value.message
    if (value.details !== undefined) merged.details = value.details
    if (value.code !== undefined) merged.code = value.code
    if (value.statusCode !== undefined) merged.statusCode = value.statusCode
    if (value.upstreamBackend !== undefined) {
      merged.upstreamBackend = value.upstreamBackend
    }
    if (value.upstreamStatus !== undefined) {
      merged.upstreamStatus = value.upstreamStatus
    }
    if (value.upstreamMessage !== undefined) {
      merged.upstreamMessage = value.upstreamMessage
    }
    if (value.requestId !== undefined) merged.requestId = value.requestId
  }

  return merged
}

function readHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined

  if (
    typeof Headers !== 'undefined' &&
    headers instanceof Headers &&
    headers.has(name)
  ) {
    return headers.get(name) ?? undefined
  }

  if (isObject(headers)) {
    const direct = headers[name] ?? headers[name.toLowerCase()]
    return typeof direct === 'string' ? direct : undefined
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    try {
      const value = (headers as { get: (key: string) => unknown }).get(name)
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

function parseEnvelopeObject(value: unknown): ParsedErrorEnvelope {
  if (!isObject(value)) return {}

  const envelope = isObject(value.error) ? value.error : value
  const metadata = isObject(envelope.metadata)
    ? envelope.metadata
    : isObject(value.metadata)
      ? value.metadata
      : {}
  const response = isObject(value.response) ? value.response : {}
  const cause = isObject(value.cause) ? value.cause : {}
  const responseHeaders = response.headers

  return {
    message: firstString(
      envelope.message,
      value.message,
      metadata.message,
      cause.message
    ),
    details: firstString(value.details, envelope.details, metadata.details),
    code: firstString(envelope.code, value.code, metadata.code),
    statusCode: firstNumber(
      value.statusCode,
      value.status,
      response.status,
      envelope.status,
      metadata.status
    ),
    upstreamBackend: firstString(
      metadata.upstream_backend,
      metadata.upstreamBackend,
      metadata.backend,
      metadata.provider,
      metadata.provider_name
    ),
    upstreamStatus: firstNumber(
      metadata.upstream_status,
      metadata.upstreamStatus,
      metadata.status_code
    ),
    upstreamMessage: firstString(
      metadata.upstream_message,
      metadata.upstreamMessage,
      metadata.provider_message
    ),
    requestId: firstString(
      value.requestId,
      value.request_id,
      envelope.requestId,
      envelope.request_id,
      metadata.requestId,
      metadata.request_id,
      readHeaderValue(responseHeaders, 'x-request-id'),
      readHeaderValue(responseHeaders, 'X-Request-ID')
    ),
  }
}

function parseErrorPayload(error: unknown): {
  rawMessage: string
  parsed: ParsedErrorEnvelope
} {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : isObject(error)
          ? (firstString(
              error.message,
              isObject(error.error) ? error.error.message : undefined
            ) ?? safeStringify(error))
          : String(error ?? 'Unknown error')

  const objectParsed = parseEnvelopeObject(error)
  const messageObject = tryParseJsonObject(rawMessage)
  const messageParsed = messageObject ? parseEnvelopeObject(messageObject) : {}

  if (isObject(error)) {
    const body = firstString(
      error.responseBody,
      error.body,
      error.data,
      isObject(error.response) ? error.response.body : undefined
    )
    if (body) {
      const bodyObject = tryParseJsonObject(body)
      if (bodyObject) {
        return {
          rawMessage,
          parsed: mergeParsedEnvelopes(
            objectParsed,
            messageParsed,
            parseEnvelopeObject(bodyObject)
          ),
        }
      }
    }
  }

  return {
    rawMessage,
    parsed: mergeParsedEnvelopes(objectParsed, messageParsed),
  }
}

/**
 * Classifies an unknown error into a structured AgentError.
 *
 * Numeric HTTP status codes take priority over keyword matching so that
 * a response like "402 Payment Required" doesn't accidentally match the
 * 'auth_error' branch via the word "required".
 */
export function classifyError(
  error: unknown,
  context: ClassifyErrorContext = {}
): AgentError {
  const { rawMessage, parsed } = parseErrorPayload(error)
  const effectiveMessage = parsed.message ?? rawMessage

  const lower = `${effectiveMessage} ${parsed.code ?? ''} ${
    parsed.upstreamMessage ?? ''
  }`.toLowerCase()

  // Extract the first HTTP status code present in the message (4xx/5xx).
  const statusMatch = effectiveMessage.match(/\b([45]\d{2})\b/)
  const statusCode =
    parsed.statusCode ??
    parsed.upstreamStatus ??
    (statusMatch ? parseInt(statusMatch[1], 10) : undefined)

  let type: AgentErrorType = 'unknown'

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    parsed.code === 'provider_not_configured' ||
    lower.includes('unauthorized') ||
    /invalid.{0,20}key/i.test(rawMessage)
  ) {
    type = 'auth_error'
  } else if (
    statusCode === 402 ||
    parsed.code === 'payment_required' ||
    lower.includes('payment') ||
    lower.includes('credit') ||
    lower.includes('billing') ||
    lower.includes('insufficient funds')
  ) {
    type = 'billing_error'
  } else if (
    statusCode === 429 ||
    parsed.code === 'too_many_requests' ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('quota')
  ) {
    type = 'rate_limit'
  } else if (
    statusCode === 408 ||
    parsed.code === 'request_timeout' ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    type = 'timeout'
  } else if (
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    parsed.code === 'bad_gateway' ||
    parsed.code === 'upstream_exhausted' ||
    lower.includes('upstream_error') ||
    lower.includes('upstream provider') ||
    lower.includes('upstream exhausted') ||
    lower.includes('service unavailable')
  ) {
    type = 'upstream_error'
  } else if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    type = 'network_error'
  } else if (
    lower.includes('model') &&
    (lower.includes('not found') ||
      lower.includes('unavailable') ||
      lower.includes('overloaded'))
  ) {
    type = 'model_error'
  } else if (
    lower.includes('tool') &&
    (lower.includes('error') || lower.includes('failed'))
  ) {
    type = 'tool_error'
  }

  const suggestion = getErrorSuggestion(type, context.provider)

  // First line of the message is the user-facing summary; multi-line messages
  // (e.g. with stack traces embedded) are demoted to details.
  const message = effectiveMessage.split('\n')[0] || effectiveMessage

  const details =
    parsed.details ??
    (error instanceof Error && error.stack && error.stack !== rawMessage
      ? error.stack
      : rawMessage !== message
        ? rawMessage
        : undefined)

  return {
    type,
    message,
    details,
    suggestion,
    timestamp: Date.now(),
    model: context.model,
    provider: context.provider,
    code: parsed.code,
    statusCode,
    upstreamBackend: parsed.upstreamBackend,
    upstreamStatus: parsed.upstreamStatus,
    upstreamMessage: parsed.upstreamMessage,
    requestId: parsed.requestId,
  }
}

/**
 * Parse a client-side Error created from an AgentError JSON payload.
 */
export function parseAgentError(error: Error): AgentError | null {
  const parsed = tryParseJsonObject(error.message)
  if (!parsed) return null

  const candidate = isObject(parsed.error) ? parsed.error : parsed
  if (!isAgentError(candidate)) {
    return null
  }

  return candidate
}

/**
 * Extract the classified {@link AgentError} from a streamed `data-error` part,
 * if the assistant message carries one.
 *
 * The agent route catches failures that happen *inside* the UI-message stream
 * (provider/tool/upstream errors that surface after the HTTP 200 headers are
 * sent) and writes them as a `data-error` data part — `{ type: 'data-error',
 * data: [AgentError] }` — rather than aborting the stream. assistant-ui's
 * built-in `MessagePrimitive.Error` only renders the runtime's own error status,
 * so without an explicit renderer these parts were silently dropped: the user
 * saw a dead, empty assistant bubble ("An error occurred" / nothing) even though
 * the server had classified the failure. This reads the part back out so the UI
 * can surface the real cause + suggestion. Scans newest→oldest and returns the
 * first valid AgentError, or null when there is none.
 */
export function extractAgentErrorFromParts(
  parts: readonly unknown[] | undefined | null
): AgentError | null {
  if (!Array.isArray(parts)) return null
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]
    if (!isObject(part) || part.type !== 'data-error') continue
    const data = part.data
    const candidate = Array.isArray(data) ? data[0] : data
    if (isAgentError(candidate)) return candidate
  }
  return null
}

export function isAgentError(value: unknown): value is AgentError {
  return (
    isObject(value) &&
    typeof value.type === 'string' &&
    typeof value.message === 'string' &&
    typeof value.suggestion === 'string' &&
    typeof value.timestamp === 'number'
  )
}
