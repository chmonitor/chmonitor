/**
 * Agent follow-up suggestion endpoint.
 *
 * POST /api/v1/agent/followups
 *
 * Generates short, context-aware questions after the main assistant response.
 * This route is intentionally separate from the streaming answer path so
 * failures never hide a completed answer.
 *
 * Ported from apps/dashboard/app/api/v1/agent/followups/route.ts.
 * - next/server NextResponse.json(x, init) -> Response.json(x, init).
 * - `export const dynamic = 'force-dynamic'` dropped (no Next static export).
 * - bridgeClickHouseEnv(env) invoked first (parity with other ported routes;
 *   keeps env shape consistent if any downstream model resolution reads it).
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { generateText, Output } from 'ai'
import { classifyError } from '@/lib/ai/agent/errors'
import {
  DEFAULT_MODEL,
  resolveAgentChatModel,
} from '@/lib/ai/agent/provider-chat-model'
import { DEFAULT_AGENT_MODEL } from '@/lib/ai/agent-model-registry'
import {
  isAnyRouterAutoModelId,
  resolveAnyRouterAutoModelId,
} from '@/lib/ai/anyrouter-dynamic-models'
import {
  getProviderName,
  isProviderConfigured,
  parseModelId,
} from '@/lib/ai/providers'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'

const MAX_MESSAGES = 12
const MAX_TEXT_CHARS = 1_200
const MAX_PROMPT_CHARS = 9_000
const MAX_REQUEST_BODY_BYTES = 64 * 1024

const FollowupsOutputSchema = z.object({
  suggestions: z
    .array(
      z
        .string()
        .trim()
        .min(8)
        .max(120)
        .describe('A short ClickHouse monitoring follow-up question.')
    )
    .min(2)
    .max(3),
})

type FollowupsRequestBody = {
  readonly messages?: unknown
  readonly model?: string
}

type FollowupsMessage = {
  readonly role: string
  readonly parts: readonly unknown[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 3)}...`
}

function getTextFromPart(part: unknown): string | null {
  if (!isObject(part) || typeof part.type !== 'string') return null
  if (part.type === 'text' && typeof part.text === 'string') {
    return part.text
  }
  if (part.type === 'reasoning' && typeof part.text === 'string') {
    return `Reasoning: ${part.text}`
  }
  if (part.type === 'data-usage') {
    return null
  }
  if (part.type === 'dynamic-tool') {
    const toolName = typeof part.toolName === 'string' ? part.toolName : 'tool'
    return `Tool call: ${toolName}`
  }
  if (part.type.startsWith('tool-')) {
    return `Tool call: ${part.type.replace(/^tool-/, '')}`
  }
  return null
}

async function readRequestBodyTextWithLimit(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const bodyStream = request.body
  if (!bodyStream) return ''

  const reader = bodyStream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
  return chunks.join('')
}

async function readJsonBody(
  request: Request
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: number; code: string; message: string }
> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Follow-up request body is too large.',
    }
  }

  let text: string
  try {
    const bodyText = await readRequestBodyTextWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    )
    if (bodyText === null) {
      return {
        ok: false,
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Follow-up request body is too large.',
      }
    }
    text = bodyText
  } catch (_error) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_BODY',
      message: 'Invalid request body',
    }
  }

  try {
    return { ok: true, value: text.trim() ? JSON.parse(text) : {} }
  } catch (_error) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_JSON',
      message: 'Invalid JSON payload',
    }
  }
}

function normalizeMessages(
  value: unknown
):
  | { ok: true; messages: FollowupsMessage[] }
  | { ok: false; code: string; message: string } {
  if (value === undefined) return { ok: true, messages: [] }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: 'INVALID_MESSAGES',
      message: 'messages must be an array.',
    }
  }

  const messages: FollowupsMessage[] = []
  for (const [index, message] of value.entries()) {
    if (
      !isObject(message) ||
      typeof message.role !== 'string' ||
      !Array.isArray(message.parts)
    ) {
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        message: `messages[${index}] must include role and parts array.`,
      }
    }

    messages.push({
      role: message.role,
      parts: message.parts,
    })
  }

  return { ok: true, messages }
}

function buildConversationContext(
  messages: readonly FollowupsMessage[]
): string {
  const lines = messages
    .slice(-MAX_MESSAGES)
    .map((message) => {
      const text = message.parts
        .map(getTextFromPart)
        .filter((part): part is string => Boolean(part))
        .join('\n')
        .trim()

      if (!text) return null

      return `${message.role}: ${clampText(text, MAX_TEXT_CHARS)}`
    })
    .filter((line): line is string => Boolean(line))

  return clampText(lines.join('\n\n'), MAX_PROMPT_CHARS)
}

function normalizeSuggestions(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const suggestions: string[] = []

  for (const value of values) {
    const text = value.replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue

    seen.add(key)
    suggestions.push(text)
    if (suggestions.length === 3) break
  }

  return suggestions
}

async function handlePost(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return Response.json(
      {
        error: {
          message: parsedBody.message,
          code: parsedBody.code,
        },
      },
      { status: parsedBody.status }
    )
  }

  const body = isObject(parsedBody.value)
    ? (parsedBody.value as FollowupsRequestBody)
    : {}

  const normalizedMessages = normalizeMessages(body.messages)
  if (!normalizedMessages.ok) {
    return Response.json(
      {
        error: {
          message: normalizedMessages.message,
          code: normalizedMessages.code,
        },
      },
      { status: 400 }
    )
  }

  let model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : DEFAULT_MODEL
  if (isAnyRouterAutoModelId(model)) {
    const top = await resolveAnyRouterAutoModelId()
    model = top ?? DEFAULT_AGENT_MODEL
  }
  const { provider: requestedProvider } = parseModelId(model)

  if (!isProviderConfigured(requestedProvider)) {
    const classified = classifyError(
      {
        statusCode: 503,
        error: {
          code: 'provider_not_configured',
          message: `Provider "${getProviderName(requestedProvider)}" is not configured on this deployment.`,
        },
      },
      { model, provider: requestedProvider }
    )

    return Response.json({ error: classified }, { status: 503 })
  }

  const context = buildConversationContext(normalizedMessages.messages)

  if (!context) {
    return Response.json({ suggestions: [] })
  }

  const { model: modelInstance, providerId } = resolveAgentChatModel({
    model,
    hasTools: false,
    referer: request.headers.get('origin') ?? undefined,
  })

  try {
    const result = await generateText({
      model: modelInstance,
      system:
        'Generate concise ClickHouse monitoring follow-up questions. Return only useful next questions a database operator would click. Do not include markdown, numbering, or explanations.',
      prompt: `Conversation context:\n${context}\n\nReturn 2 or 3 short follow-up questions that naturally continue this investigation.`,
      output: Output.object({
        schema: FollowupsOutputSchema,
      }),
    })

    const suggestions = normalizeSuggestions(result.output.suggestions)
    if (suggestions.length < 2) {
      throw new Error('Follow-up generation returned too few suggestions.')
    }

    return Response.json({ suggestions })
  } catch (error) {
    const classified = classifyError(error, { model, provider: providerId })
    console.error('[Agent Followups API] Classified error:', classified)
    return Response.json(
      {
        error: classified,
      },
      { status: classified.statusCode ?? 502 }
    )
  }
}

export const Route = createFileRoute('/api/v1/agent/followups')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
