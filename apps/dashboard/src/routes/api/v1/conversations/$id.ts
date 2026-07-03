/**
 * Single conversation API endpoint
 * GET /api/v1/conversations/$id - Get single conversation with messages
 * PUT /api/v1/conversations/$id - Update conversation (messages, title)
 * DELETE /api/v1/conversations/$id - Delete conversation
 *
 * Ported from apps/dashboard/app/api/v1/conversations/[id]/route.ts (Next.js)
 * to TanStack Start. Logic is preserved verbatim; the Next dynamic-segment
 * `{ params }: { params: Promise<{ id: string }> }` (awaited) becomes the
 * already-resolved TanStack Start `params` (`params.id` is synchronous), and
 * the `export const dynamic` route-segment export is dropped.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { UIMessage } from 'ai'
import type { StoredConversation } from '@/lib/conversation-store/types'

import { debug, error, generateRequestId } from '@chm/logger'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveUserId } from '@/lib/conversation-store/auth'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { ConversationStoreError } from '@/lib/conversation-store/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT_GET = { route: '/api/v1/conversations/$id', method: 'GET' }
const ROUTE_CONTEXT_PUT = { route: '/api/v1/conversations/$id', method: 'PUT' }
const ROUTE_CONTEXT_DELETE = {
  route: '/api/v1/conversations/$id',
  method: 'DELETE',
}

/**
 * Conversation update request payload
 */
export interface UpdateConversationRequest {
  /** Optional new title for the conversation */
  title?: string
  /** Optional updated messages array (replaces existing messages) */
  messages?: UIMessage[]
}

/**
 * Full conversation response with messages
 */
export interface ConversationResponse extends StoredConversation {}

/**
 * Handle GET requests for single conversation
 */
async function handleGet(id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations/$id] Fetching conversation', {
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

    // Resolve authenticated user (or guest)
    const userId = await resolveUserId()
    debug('[GET /api/v1/conversations/$id] User resolved', {
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

    // Resolve store and fetch conversation
    const store = await resolveStore()
    const conversation = await store.get(userId, id)

    // Check if conversation exists
    if (!conversation) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Conversation not found',
          details: {
            timestamp: new Date().toISOString(),
            conversationId: id,
          },
        },
        404,
        ROUTE_CONTEXT_GET
      )
    }

    // Create response with standardized builder
    const response = createSuccessResponse(
      { conversation },
      {
        queryId: 'conversation-get',
        rows: 1,
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
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error occurred'

    error('[GET /api/v1/conversations/$id] Error:', err, { requestId })

    // Handle conversation store errors
    if (err instanceof ConversationStoreError) {
      const errorType =
        err.code === 'NOT_FOUND'
          ? ApiErrorType.ValidationError
          : err.code === 'UNAUTHORIZED'
            ? ApiErrorType.PermissionError
            : ApiErrorType.QueryError

      const statusCode =
        err.code === 'NOT_FOUND' || err.code === 'UNAUTHORIZED' ? 404 : 500

      return createApiErrorResponse(
        {
          type: errorType,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        statusCode,
        ROUTE_CONTEXT_GET
      )
    }

    const errorResponse = createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: errorMessage,
        details: {
          timestamp: new Date().toISOString(),
        },
      },
      500,
      ROUTE_CONTEXT_GET
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
 * Create or update a conversation by id using the provided `title` and/or `messages`.
 *
 * Validates the conversation id and request body, constructs a new or merged conversation
 * record (setting `createdAt` when creating and `updatedAt` on every update), persists it,
 * and returns the saved conversation in a standardized success response. On error returns
 * a standardized API error response with an appropriate status code.
 *
 * @param request - The incoming HTTP request
 * @param id - The conversation id from the dynamic route segment
 * @returns A Response whose body is a standardized success object containing `conversation` on success, or an API error object on failure
 */
async function handlePut(request: Request, id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[PUT /api/v1/conversations/$id] Updating conversation', {
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
        ROUTE_CONTEXT_PUT
      )
    }

    // Resolve authenticated user (or guest)
    const userId = await resolveUserId()
    debug('[PUT /api/v1/conversations/$id] User resolved', {
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
        ROUTE_CONTEXT_PUT
      )
    }

    // Parse request body
    const body = (await request.json()) as UpdateConversationRequest
    const { title, messages } = body

    // Validate at least one field is being updated
    if (title === undefined && messages === undefined) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'No update data provided. Specify title or messages.',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_PUT
      )
    }

    // Validate messages array if provided
    if (messages !== undefined && !Array.isArray(messages)) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid field: messages must be an array',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_PUT
      )
    }

    // Resolve store and fetch existing conversation
    const store = await resolveStore()
    const existingConversation = await store.get(userId, id)

    // Build create-or-update conversation (needed for localStorage migration PUT uploads)
    const now = Date.now()
    const baseMessages = messages ?? existingConversation?.messages ?? []
    const updatedConversation: StoredConversation = {
      id,
      userId,
      title: title ?? existingConversation?.title ?? 'Untitled Conversation',
      messages: baseMessages,
      messageCount: baseMessages.length,
      createdAt: existingConversation?.createdAt ?? now,
      updatedAt: now,
    }

    // Save to store. The store enforces ownership at the write layer (see
    // conversation-store/*.ts): a foreign-owned id is refused rather than
    // reassigned to the caller, surfaced here as `written: false`.
    const { written } = await store.upsert(updatedConversation)

    // existingConversation came from a user-scoped read, so it is null both
    // for a genuinely new id (write always succeeds) and for an id owned by
    // another user (write is blocked). Only the latter yields `written:
    // false` here, so this precisely detects the blocked cross-tenant case.
    if (!written && existingConversation === null) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Conversation ID belongs to another user.',
          details: { timestamp: new Date().toISOString() },
        },
        409,
        ROUTE_CONTEXT_PUT
      )
    }

    // Create response with standardized builder
    const response = createSuccessResponse(
      { conversation: updatedConversation },
      {
        queryId: 'conversation-update',
        rows: 1,
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
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error occurred'

    error('[PUT /api/v1/conversations/$id] Error:', err, { requestId })

    // Handle conversation store errors
    if (err instanceof ConversationStoreError) {
      const errorType =
        err.code === 'NOT_FOUND'
          ? ApiErrorType.ValidationError
          : err.code === 'VALIDATION_ERROR'
            ? ApiErrorType.ValidationError
            : err.code === 'UNAUTHORIZED'
              ? ApiErrorType.PermissionError
              : ApiErrorType.QueryError

      const statusCode =
        err.code === 'NOT_FOUND' ||
        err.code === 'VALIDATION_ERROR' ||
        err.code === 'UNAUTHORIZED'
          ? 404
          : 500

      return createApiErrorResponse(
        {
          type: errorType,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        statusCode,
        ROUTE_CONTEXT_PUT
      )
    }

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && errorMessage.includes('JSON')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid JSON in request body',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_PUT
      )
    }

    const errorResponse = createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: errorMessage,
        details: {
          timestamp: new Date().toISOString(),
        },
      },
      500,
      ROUTE_CONTEXT_PUT
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
 * Handle DELETE requests to delete conversation
 */
async function handleDelete(id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[DELETE /api/v1/conversations/$id] Deleting conversation', {
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
        ROUTE_CONTEXT_DELETE
      )
    }

    // Resolve authenticated user (or guest)
    const userId = await resolveUserId()
    debug('[DELETE /api/v1/conversations/$id] User resolved', {
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
        ROUTE_CONTEXT_DELETE
      )
    }

    // Resolve store and check if conversation exists
    const store = await resolveStore()
    const existingConversation = await store.get(userId, id)

    // Check if conversation exists
    if (!existingConversation) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Conversation not found',
          details: {
            timestamp: new Date().toISOString(),
            conversationId: id,
          },
        },
        404,
        ROUTE_CONTEXT_DELETE
      )
    }

    // Delete conversation
    await store.delete(userId, id)

    // Create response with standardized builder
    const response = createSuccessResponse(
      { deleted: true, conversationId: id },
      {
        queryId: 'conversation-delete',
        rows: 1,
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
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error occurred'

    error('[DELETE /api/v1/conversations/$id] Error:', err, { requestId })

    // Handle conversation store errors
    if (err instanceof ConversationStoreError) {
      const errorType =
        err.code === 'NOT_FOUND'
          ? ApiErrorType.ValidationError
          : err.code === 'UNAUTHORIZED'
            ? ApiErrorType.PermissionError
            : ApiErrorType.QueryError

      const statusCode =
        err.code === 'NOT_FOUND' || err.code === 'UNAUTHORIZED' ? 404 : 500

      return createApiErrorResponse(
        {
          type: errorType,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        statusCode,
        ROUTE_CONTEXT_DELETE
      )
    }

    const errorResponse = createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: errorMessage,
        details: {
          timestamp: new Date().toISOString(),
        },
      },
      500,
      ROUTE_CONTEXT_DELETE
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

export const Route = createFileRoute('/api/v1/conversations/$id')({
  server: {
    handlers: {
      GET: ({ params }) => handleGet(params.id),
      PUT: ({ request, params }) => handlePut(request, params.id),
      DELETE: ({ params }) => handleDelete(params.id),
    },
  },
})
