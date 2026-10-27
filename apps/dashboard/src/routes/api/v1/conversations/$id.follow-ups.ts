/**
 * Conversation follow-up suggestions API endpoint
 * GET /api/v1/conversations/$id/follow-ups - AI-generated follow-up questions
 *
 * Follow-up generation is only available when the resolved conversation store
 * is the AgentState backend (it relies on AgentState's AI enrichment). For any
 * other backend the endpoint returns 501.
 */

import { createFileRoute } from '@tanstack/react-router'

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
import { AgentStateStore } from '@/lib/conversation-store/agentstate-store'
import { resolveConversationUserId } from '@/lib/conversation-store/auth'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { isConversationDbEnabled } from '@/lib/conversation-store/server-feature'
import { ConversationStoreError } from '@/lib/conversation-store/types'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT_GET = {
  route: '/api/v1/conversations/$id/follow-ups',
  method: 'GET',
}

/**
 * Handle GET requests for conversation follow-up suggestions.
 */
async function handleGet(request: Request, id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations/$id/follow-ups] Generating follow-ups', {
    conversationId: id,
    requestId,
  })

  try {
    // Auth before the feature check: an anonymous caller is rejected,
    // never shown a 501 that reveals how storage is configured (#4020).
    const userId = await resolveConversationUserId(request)

    await autoMigrate()

    // Guard: conversation persistence must be explicitly enabled
    if (!isConversationDbEnabled()) {
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

    debug('[GET /api/v1/conversations/$id/follow-ups] User resolved', {
      userId,
      requestId,
    })

    if (!id) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Missing conversation ID',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_GET
      )
    }

    // Resolve store and ensure it supports follow-up generation
    const store = await resolveStore()
    if (!(store instanceof AgentStateStore)) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Follow-up suggestions require the AgentState backend.',
          details: { timestamp: new Date().toISOString() },
        },
        501,
        ROUTE_CONTEXT_GET
      )
    }

    const questions = await store.followUps(userId, id)

    const response = createSuccessResponse(
      { questions },
      {
        queryId: 'conversation-follow-ups',
        rows: questions.length,
      }
    )

    const newHeaders = new Headers(response.headers)
    newHeaders.set('X-Request-ID', requestId)
    newHeaders.set('Cache-Control', CacheControl.NONE)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  } catch (err) {
    error('[GET /api/v1/conversations/$id/follow-ups] Error:', err, {
      requestId,
    })

    if (
      err instanceof ConversationStoreError &&
      (err.code === 'NOT_FOUND' || err.code === 'UNAUTHORIZED')
    ) {
      return createApiErrorResponse(
        {
          type:
            err.code === 'NOT_FOUND'
              ? ApiErrorType.ValidationError
              : ApiErrorType.PermissionError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        404,
        ROUTE_CONTEXT_GET
      )
    }

    const errorResponse = createInternalErrorResponse(
      err,
      ROUTE_CONTEXT_GET,
      requestId
    )

    const errorHeaders = new Headers(errorResponse.headers)
    errorHeaders.set('X-Request-ID', requestId)

    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers: errorHeaders,
    })
  }
}

export const Route = createFileRoute('/api/v1/conversations/$id/follow-ups')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.id),
    },
  },
})
