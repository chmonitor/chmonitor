/**
 * Conversations API endpoint
 * GET /api/v1/conversations - List conversations (meta only, no messages)
 * POST /api/v1/conversations - Create new conversation
 *
 * Ported from apps/dashboard/app/api/v1/conversations/route.ts (Next.js) to
 * TanStack Start. The GET/POST bodies are preserved verbatim; only the Next
 * route-segment export (`export const dynamic`) is dropped and the handlers
 * are wired through `createFileRoute().server.handlers`.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { UIMessage } from 'ai'
import type {
  ConversationMeta,
  StoredConversation,
} from '@/lib/conversation-store/types'

import { debug, error, generateRequestId } from '@chm/logger'
import {
  createErrorResponse as createApiErrorResponse,
  createInternalErrorResponse,
} from '@/lib/api/error-handler'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { retentionCutoffMs } from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { resolveUserId } from '@/lib/conversation-store/auth'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { ConversationStoreError } from '@/lib/conversation-store/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT_GET = { route: '/api/v1/conversations', method: 'GET' }
const ROUTE_CONTEXT_POST = { route: '/api/v1/conversations', method: 'POST' }

const DEFAULT_LIMIT = 20

/**
 * Conversation creation request payload
 */
export interface CreateConversationRequest {
  /** Optional conversation title (auto-generated from first message if not provided) */
  title?: string
  /** Initial messages for the conversation */
  messages?: UIMessage[]
}

/**
 * Conversation creation response
 */
export interface CreateConversationResponse {
  /** Created conversation ID */
  id: string
  /** User ID who owns this conversation */
  userId: string
  /** Conversation title */
  title: string
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** Last update timestamp (Unix ms) */
  updatedAt: number
}

/**
 * Handle GET requests for conversations list
 */
async function handleGet(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations] Fetching conversations', { requestId })

  try {
    // Run pending migrations on first request
    await autoMigrate()

    // Guard: conversation persistence must be explicitly enabled
    if (!isFeatureEnabled('conversationDb')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Conversation storage is not enabled.',
          details: { timestamp: new Date().toISOString() },
        },
        501,
        ROUTE_CONTEXT_GET
      )
    }

    // Resolve authenticated user (or guest)
    const userId = await resolveUserId()
    debug('[GET /api/v1/conversations] User resolved', { userId, requestId })

    // Get limit from query params (reject non-numeric/negative values)
    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const parsedLimit = limitParam ? Number(limitParam) : DEFAULT_LIMIT
    const normalizedLimit = Math.floor(parsedLimit)
    const limit =
      Number.isFinite(parsedLimit) && normalizedLimit > 0
        ? Math.min(normalizedLimit, 100)
        : DEFAULT_LIMIT

    // Resolve retention cutoff from billing plan (cloud/Clerk only).
    // Any failure (OSS, no Clerk, unauthenticated) is silent — no cutoff applied.
    let sinceMs: number | undefined
    try {
      const owner = await resolveBillingOwner()
      const plan = await getPlanForOwner(owner.id)
      const cutoff = retentionCutoffMs(plan)
      if (cutoff != null) sinceMs = cutoff
    } catch {
      // Non-cloud / unauthenticated: no retention filter
    }

    // Resolve store and fetch conversations
    const store = await resolveStore()
    const conversations = await store.list(userId, limit, sinceMs)

    // Transform response to exclude internal fields
    const responseMeta: ConversationMeta[] = conversations.map((conv) => ({
      id: conv.id,
      userId: conv.userId,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv.messageCount,
    }))

    // Create response with standardized builder
    const response = createSuccessResponse(
      { conversations: responseMeta },
      {
        queryId: 'conversations-list',
        rows: responseMeta.length,
      }
    )

    // Add request ID header
    const newHeaders = new Headers(response.headers)
    newHeaders.set('X-Request-ID', requestId)
    newHeaders.set('Cache-Control', CacheControl.NONE)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  } catch (err) {
    error('[GET /api/v1/conversations] Error:', err, { requestId })

    // Handle conversation store errors
    if (err instanceof ConversationStoreError && err.code === 'UNAUTHORIZED') {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        403,
        ROUTE_CONTEXT_GET
      )
    }

    const errorResponse = createInternalErrorResponse(
      err,
      ROUTE_CONTEXT_GET,
      requestId
    )

    // Add request ID header to error response
    const errorHeaders = new Headers(errorResponse.headers)
    errorHeaders.set('X-Request-ID', requestId)

    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers: errorHeaders,
    })
  }
}

/**
 * Handle POST requests to create new conversation
 */
async function handlePost(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[POST /api/v1/conversations] Creating conversation', { requestId })

  try {
    // Run pending migrations on first request
    await autoMigrate()

    // Guard: conversation persistence must be explicitly enabled
    if (!isFeatureEnabled('conversationDb')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Conversation storage is not enabled.',
          details: { timestamp: new Date().toISOString() },
        },
        501,
        ROUTE_CONTEXT_POST
      )
    }

    // Resolve authenticated user (or guest)
    const userId = await resolveUserId()
    debug('[POST /api/v1/conversations] User resolved', { userId, requestId })

    // Parse request body
    const body = (await request.json()) as CreateConversationRequest
    const { title, messages = [] } = body

    // Validate messages array if provided
    if (!Array.isArray(messages)) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid field: messages must be an array',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_POST
      )
    }

    // Generate conversation ID and timestamp
    const conversationId = crypto.randomUUID()
    const now = Date.now()

    // Auto-generate title from first user message if not provided
    let conversationTitle = title || 'New Conversation'
    if (!title && messages.length > 0) {
      const firstUserMessage = messages.find((m) => m.role === 'user')
      if (firstUserMessage?.parts && firstUserMessage.parts.length > 0) {
        // Find the first text part
        const textPart = firstUserMessage.parts.find(
          (part) => part.type === 'text'
        )
        if (textPart && 'text' in textPart) {
          const content = textPart.text

          // Truncate to 50 characters
          conversationTitle = content.substring(0, 50).trim()
          if (content.length > 50) {
            conversationTitle += '...'
          }
        }
      }
    }

    // Build stored conversation
    const storedConversation: StoredConversation = {
      id: conversationId,
      userId,
      title: conversationTitle,
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      messages,
    }

    // Save to store. The id is freshly minted above (crypto.randomUUID()),
    // so `written` should always be true; handle `false` defensively as an
    // unexpected id collision rather than returning a misleading 200.
    const store = await resolveStore()
    const { written } = await store.upsert(storedConversation)

    if (!written) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Conversation ID collision. Please retry.',
          details: { timestamp: new Date().toISOString() },
        },
        409,
        ROUTE_CONTEXT_POST
      )
    }

    // Build response
    const responseData: CreateConversationResponse = {
      id: storedConversation.id,
      userId: storedConversation.userId,
      title: storedConversation.title,
      createdAt: storedConversation.createdAt,
      updatedAt: storedConversation.updatedAt,
    }

    // Create response with standardized builder (201 Created)
    const response = createSuccessResponse(
      responseData,
      {
        queryId: 'conversation-create',
        rows: 1,
      },
      201
    )

    // Add request ID header
    const newHeaders = new Headers(response.headers)
    newHeaders.set('X-Request-ID', requestId)
    newHeaders.set('Cache-Control', CacheControl.NONE)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  } catch (err) {
    error('[POST /api/v1/conversations] Error:', err, { requestId })

    // Handle conversation store errors
    if (
      err instanceof ConversationStoreError &&
      (err.code === 'VALIDATION_ERROR' || err.code === 'UNAUTHORIZED')
    ) {
      return createApiErrorResponse(
        {
          type:
            err.code === 'VALIDATION_ERROR'
              ? ApiErrorType.ValidationError
              : ApiErrorType.PermissionError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        err.code === 'VALIDATION_ERROR' ? 400 : 403,
        ROUTE_CONTEXT_POST
      )
    }

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid JSON in request body',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_POST
      )
    }

    const errorResponse = createInternalErrorResponse(
      err,
      ROUTE_CONTEXT_POST,
      requestId
    )

    // Add request ID header to error response
    const errorHeaders = new Headers(errorResponse.headers)
    errorHeaders.set('X-Request-ID', requestId)

    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers: errorHeaders,
    })
  }
}

export const Route = createFileRoute('/api/v1/conversations')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
})
