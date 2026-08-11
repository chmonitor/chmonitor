/**
 * Request parsing / input shaping for POST /api/v1/agent.
 *
 * Everything here is pure (aside from reading the request body) so the limit
 * behaviour is unit-testable without a worker runtime. Extracted from
 * `routes/api/v1/agent.ts` in issue #2885 — every limit value and every
 * rejection reason is unchanged.
 */

import type { CustomMcpServerInput } from '@/lib/ai/agent/mcp/connect-custom-servers'

import { AGENT_DEBUG_LOGS } from './debug'
import { parseByokApiKey } from '@/lib/ai/agent/byok'

export const AGENT_MAX_REQUEST_SIZE_BYTES = 128 * 1024
export const AGENT_MAX_MESSAGES = 64
export const AGENT_MAX_MESSAGE_PARTS = 64
export const AGENT_MAX_USER_MESSAGE_LENGTH = 8_192
export const AGENT_MAX_PART_TEXT_LENGTH = 2_048
// Page-context is a short grounding hint ("user is on the Merges page"), not
// a message body — cap it much tighter than a chat message.
export const AGENT_MAX_PAGE_CONTEXT_FIELD_LENGTH = 200

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export type AgentRequestBody = {
  message?: string
  messages?: Array<
    | { id: string; role: string; parts: Array<unknown> }
    | { role: string; content: string; parts?: unknown[] }
  >
  hostId?: number
  model?: string
  /**
   * BYOK — the user's own model-provider API key. When present and valid, the
   * request runs against their provider credit and chmonitor skips its own
   * included-credit metering (see `lib/ai/agent/byok.ts`). Never persisted or
   * logged.
   */
  apiKey?: string
  disabledTools?: string[]
  sessionId?: string
  mcpServers?: Array<{ id?: unknown; name?: unknown; endpoint?: unknown }>
  /**
   * Optional hint about the dashboard page the chat was opened/sent from
   * (e.g. `{ route: '/merges', label: 'Merges' }`). Purely additive — a
   * request omitting this field behaves exactly as before. See
   * `sanitizePageContext` / `buildPageContextLine`.
   */
  pageContext?: { route?: unknown; label?: unknown }
}

/** Sanitized, safe-to-use page-context hint. */
export type SafePageContext = {
  readonly route: string
  readonly label?: string
}

export type SafeAgentMessage = {
  readonly id: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly parts: Array<{
    [key: string]: unknown
    type: string
  }>
  readonly content?: string
}

type SanitizeIncomingMessagesResult =
  | {
      readonly ok: true
      readonly messages: ReadonlyArray<SafeAgentMessage>
    }
  | {
      readonly ok: false
      readonly reason: 'too_many_messages'
    }

/** Every way a request can be rejected before any agent work happens. */
export type ParseAgentRequestFailure = {
  readonly ok: false
  readonly reason:
    | 'payload_too_large'
    | 'invalid_json'
    | 'too_many_messages'
    | 'no_valid_messages'
    | 'message_required'
}

/** The validated, clamped request the handler works with. */
export type ParsedAgentRequest = {
  readonly ok: true
  readonly body: AgentRequestBody
  readonly safeIncomingMessages: ReadonlyArray<SafeAgentMessage>
  readonly userMessage: string | undefined
  readonly hostId: number
  readonly disabledTools: string[]
  readonly sessionId: string
  readonly byokApiKey: string | null
  readonly mcpServers: CustomMcpServerInput[]
  readonly pageContext: SafePageContext | undefined
}

export type ParseAgentRequestResult =
  | ParsedAgentRequest
  | ParseAgentRequestFailure

/**
 * Check whether a value is an object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Truncate text to a safe UTF-8 byte length.
 */
export function clampText(value: string, maxBytes: number): string {
  const encoded = textEncoder.encode(value)
  if (encoded.length <= maxBytes) {
    return value
  }

  let end = maxBytes
  while (
    end > 0 &&
    end < encoded.length &&
    (encoded[end] & 0b1100_0000) === 0b1000_0000
  ) {
    end -= 1
  }

  return textDecoder.decode(encoded.slice(0, end))
}

/**
 * Validate and clamp the client-supplied `pageContext` hint.
 *
 * Returns `undefined` for anything malformed/empty so callers can simply
 * treat a missing hint and an invalid one the same way (no page context).
 */
export function sanitizePageContext(
  raw: AgentRequestBody['pageContext']
): SafePageContext | undefined {
  if (!isObject(raw) || typeof raw.route !== 'string') {
    return undefined
  }

  const route = clampText(raw.route.trim(), AGENT_MAX_PAGE_CONTEXT_FIELD_LENGTH)
  if (!route) {
    return undefined
  }

  const label =
    typeof raw.label === 'string' && raw.label.trim().length > 0
      ? clampText(raw.label.trim(), AGENT_MAX_PAGE_CONTEXT_FIELD_LENGTH)
      : undefined

  return label ? { route, label } : { route }
}

/**
 * Build the short synthetic context line describing the page the user is on.
 * Kept out of the (byte-stable, cached) system prompt on purpose — this is
 * threaded in as a separate message ahead of the user's turn instead.
 */
export function buildPageContextLine(
  pageContext: SafePageContext,
  hostId: number
): string {
  const page = pageContext.label ?? pageContext.route
  return `Context: the user is currently viewing the "${page}" page (host ${hostId}).`
}

export async function readRequestBodyTextWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ text: string; byteLength: number } | null> {
  const bodyStream = request.body
  if (!bodyStream) {
    return { text: '', byteLength: 0 }
  }

  const reader = bodyStream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      byteLength += value.length
      if (byteLength > maxBytes) {
        try {
          await reader.cancel()
        } catch (_error) {
          // Ignore cancellation errors if the stream is already closed.
        }
        return null
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }

  chunks.push(decoder.decode())
  return { text: chunks.join(''), byteLength }
}

/**
 * Sanitize one message part.
 */
export function sanitizeMessagePart(part: unknown): {
  [key: string]: unknown
  type: string
} | null {
  if (!isObject(part) || typeof part.type !== 'string') {
    return null
  }

  const safePart: { [key: string]: unknown; type: string } = {
    ...part,
    type: part.type,
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    safePart.text = clampText(part.text, AGENT_MAX_PART_TEXT_LENGTH)
  }

  return safePart
}

/**
 * Map model roles into the accepted role set.
 */
export function normalizeRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

/**
 * Sanitize raw user messages into the safe internal message shape.
 *
 * - Cap total messages at `AGENT_MAX_MESSAGES`.
 * - Cap per-message parts at `AGENT_MAX_MESSAGE_PARTS`.
 * - Clamp text fields to configured byte limits.
 * - Drops malformed/empty messages.
 */
export function sanitizeIncomingMessages(
  messages: unknown[] | undefined
): SanitizeIncomingMessagesResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: true, messages: [] }
  }

  if (messages.length > AGENT_MAX_MESSAGES) {
    return { ok: false, reason: 'too_many_messages' }
  }

  const sanitizedMessages = messages
    .map((msg): SafeAgentMessage | null => {
      if (!isObject(msg) || typeof msg.role !== 'string') {
        return null
      }

      const role = normalizeRole(msg.role)
      const parts = Array.isArray(msg.parts)
        ? msg.parts
            .slice(0, AGENT_MAX_MESSAGE_PARTS)
            .map(sanitizeMessagePart)
            .filter(
              (part): part is { type: string; [key: string]: unknown } =>
                part !== null
            )
        : []

      const contentRaw = msg.content
      const content =
        typeof contentRaw === 'string'
          ? clampText(contentRaw, AGENT_MAX_USER_MESSAGE_LENGTH)
          : null

      if (parts.length === 0 && !content) {
        return null
      }

      return {
        id: typeof msg.id === 'string' ? msg.id : crypto.randomUUID(),
        role,
        parts,
        content: content ?? undefined,
      }
    })
    .filter((value): value is SafeAgentMessage => value !== null)

  return { ok: true, messages: sanitizedMessages }
}

/**
 * Read, size-limit, JSON-parse, sanitize and validate an agent request.
 *
 * Returns a discriminated result rather than throwing so the caller maps each
 * rejection to its (unchanged) HTTP response via `parseFailureResponse`.
 */
export async function parseAgentRequest(
  request: Request
): Promise<ParseAgentRequestResult> {
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const declaredSize = Number(contentLengthHeader)
    if (
      !Number.isNaN(declaredSize) &&
      declaredSize > AGENT_MAX_REQUEST_SIZE_BYTES
    ) {
      return { ok: false, reason: 'payload_too_large' }
    }
  }

  const requestBodyResult = await readRequestBodyTextWithLimit(
    request,
    AGENT_MAX_REQUEST_SIZE_BYTES
  )
  if (requestBodyResult === null) {
    return { ok: false, reason: 'payload_too_large' }
  }

  let body: AgentRequestBody
  try {
    const parsedBody = JSON.parse(requestBodyResult.text)
    if (
      !isObject(parsedBody) ||
      Array.isArray(parsedBody) ||
      parsedBody === null
    ) {
      throw new Error('INVALID_PAYLOAD')
    }

    body = parsedBody
  } catch (_error) {
    return { ok: false, reason: 'invalid_json' }
  }

  if (AGENT_DEBUG_LOGS) {
    console.log('[Agent API] Request body keys:', Object.keys(body))
    console.log('[Agent API] Messages count:', body.messages?.length)
  }

  const safeIncomingMessagesResult = sanitizeIncomingMessages(body.messages)
  if (!safeIncomingMessagesResult.ok) {
    return { ok: false, reason: 'too_many_messages' }
  }

  const safeIncomingMessages = safeIncomingMessagesResult.messages

  if (
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    safeIncomingMessages.length === 0 &&
    typeof body.message !== 'string'
  ) {
    return { ok: false, reason: 'no_valid_messages' }
  }

  const lastUserMessage = safeIncomingMessages
    .filter((m) => m.role === 'user')
    ?.pop()

  const textPart = lastUserMessage?.parts?.find(
    (p): p is { type: 'text'; text: string } =>
      typeof p === 'object' &&
      p !== null &&
      'type' in p &&
      p.type === 'text' &&
      'text' in p &&
      typeof p.text === 'string' &&
      p.text.trim().length > 0
  )

  const userMessage =
    (typeof body.message === 'string'
      ? clampText(body.message, AGENT_MAX_USER_MESSAGE_LENGTH)
      : undefined) ||
    textPart?.text ||
    lastUserMessage?.content

  const hasNonTextParts =
    Array.isArray(lastUserMessage?.parts) &&
    lastUserMessage.parts.length > 0 &&
    !textPart

  if (
    !hasNonTextParts &&
    (typeof userMessage !== 'string' || !userMessage.trim())
  ) {
    return { ok: false, reason: 'message_required' }
  }

  const rawHostId =
    typeof body.hostId === 'string' ? Number(body.hostId) : body.hostId
  const hostId =
    typeof rawHostId === 'number' && Number.isFinite(rawHostId)
      ? Math.max(0, Math.trunc(rawHostId))
      : 0

  const disabledTools = Array.isArray(body.disabledTools)
    ? body.disabledTools.filter((t) => typeof t === 'string')
    : []
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.length > 0
      ? body.sessionId
      : crypto.randomUUID()

  // BYOK: the user may supply their own provider API key. When present and
  // valid, it (a) overrides the deployment's env key for this request and (b)
  // makes the request bypass included-credit metering — the request bills their
  // provider account. Parsed once here; never logged.
  const byokApiKey = parseByokApiKey(body.apiKey)

  // Parse and validate custom MCP servers from the request body.
  const rawMcpServers = Array.isArray(body.mcpServers)
    ? body.mcpServers.slice(0, 5)
    : []
  const mcpServers: CustomMcpServerInput[] = rawMcpServers
    .filter(
      (s): s is { id: string; name: string; endpoint: string } =>
        isObject(s) &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.endpoint === 'string'
    )
    .map((s) => ({ id: s.id, name: s.name, endpoint: s.endpoint }))

  return {
    ok: true,
    body,
    safeIncomingMessages,
    userMessage,
    hostId,
    disabledTools,
    sessionId,
    byokApiKey,
    mcpServers,
    pageContext: sanitizePageContext(body.pageContext),
  }
}
