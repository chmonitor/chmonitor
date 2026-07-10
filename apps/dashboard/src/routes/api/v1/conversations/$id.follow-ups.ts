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
import { resolveUserId } from '@/lib/conversation-store/auth'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { ConversationStoreError } from '@/lib/conversation-store/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT_GET = {
  route: '/api/v1/conversations/$id/follow-ups',
  method: 'GET',
}

/**
 * Handle GET requests for conversation follow-up suggestions.
 */
async function handleGet(id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations/$id/follow-ups] Generating follow-ups', {
    conversationId: id,
    requestId,
  })

  try {
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

    // Resolve authenticated user
    const userId = await resolveUserId()
    debug('[GET /api/v1/conversations/$id/follow-ups] User resolved', {
      userId,
      requestId,
    })

    // Validate conversation ID
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

    // Create response with standardized builder
    const response = createSuccessResponse(
      { questions },
      {
        queryId: 'conversation-follow-ups',
        rows: questions.length,
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
    error('[GET /api/v1/conversations/$id/follow-ups] Error:', err, {
      requestId,
    })

    // Handle conversation store errors
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

export const Route = createFileRoute('/api/v1/conversations/$id/follow-ups')({
  server: {
    handlers: {
      GET: ({ params }) => handleGet(params.id),
    },
  },
})
