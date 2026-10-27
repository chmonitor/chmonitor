/**
 * Single conversation API endpoint
 * GET /api/v1/conversations/$id - Get single conversation with messages
 * PUT /api/v1/conversations/$id - Update conversation (messages, title)
 * DELETE /api/v1/conversations/$id - Delete conversation
 *
 * `params.id` is the already-resolved TanStack Start route param (synchronous).
 */

import { createFileRoute } from '@tanstack/react-router'

import type { UIMessage } from 'ai'
import type { StoredConversation } from '@/lib/conversation-store/types'

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
import { resolveConversationUserId } from '@/lib/conversation-store/auth'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { isConversationDbEnabled } from '@/lib/conversation-store/server-feature'
import { ConversationStoreError } from '@/lib/conversation-store/types'
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
async function handleGet(request: Request, id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations/$id] Fetching conversation', {
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

    debug('[GET /api/v1/conversations/$id] User resolved', {
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

    const store = await resolveStore()
    const conversation = await store.get(userId, id)

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

    const response = createSuccessResponse(
      { conversation },
      {
        queryId: 'conversation-get',
        rows: 1,
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
    error('[GET /api/v1/conversations/$id] Error:', err, { requestId })

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
        ROUTE_CONTEXT_PUT
      )
    }

    debug('[PUT /api/v1/conversations/$id] User resolved', {
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
        ROUTE_CONTEXT_PUT
      )
    }

    let body: UpdateConversationRequest
    try {
      body = (await request.json()) as UpdateConversationRequest
    } catch {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid JSON body',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_PUT
      )
    }
    const { title, messages } = body

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

    const response = createSuccessResponse(
      { conversation: updatedConversation },
      {
        queryId: 'conversation-update',
        rows: 1,
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
    error('[PUT /api/v1/conversations/$id] Error:', err, { requestId })

    if (
      err instanceof ConversationStoreError &&
      (err.code === 'NOT_FOUND' ||
        err.code === 'VALIDATION_ERROR' ||
        err.code === 'UNAUTHORIZED')
    ) {
      return createApiErrorResponse(
        {
          type:
            err.code === 'UNAUTHORIZED'
              ? ApiErrorType.PermissionError
              : ApiErrorType.ValidationError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        404,
        ROUTE_CONTEXT_PUT
      )
    }

    if (err instanceof SyntaxError && err.message.includes('JSON')) {
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

    const errorResponse = createInternalErrorResponse(
      err,
      ROUTE_CONTEXT_PUT,
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

/**
 * Handle DELETE requests to delete conversation
 */
async function handleDelete(request: Request, id: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[DELETE /api/v1/conversations/$id] Deleting conversation', {
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
        ROUTE_CONTEXT_DELETE
      )
    }

    debug('[DELETE /api/v1/conversations/$id] User resolved', {
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
        ROUTE_CONTEXT_DELETE
      )
    }

    // Resolve store and check if conversation exists
    const store = await resolveStore()
    const existingConversation = await store.get(userId, id)

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

    await store.delete(userId, id)

    const response = createSuccessResponse(
      { deleted: true, conversationId: id },
      {
        queryId: 'conversation-delete',
        rows: 1,
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
    error('[DELETE /api/v1/conversations/$id] Error:', err, { requestId })

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
        ROUTE_CONTEXT_DELETE
      )
    }

    const errorResponse = createInternalErrorResponse(
      err,
      ROUTE_CONTEXT_DELETE,
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

export const Route = createFileRoute('/api/v1/conversations/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.id),
      PUT: ({ request, params }) => handlePut(request, params.id),
      DELETE: ({ request, params }) => handleDelete(request, params.id),
    },
  },
})
