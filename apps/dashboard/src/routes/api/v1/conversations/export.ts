/**
 * Conversation export API endpoint
 * GET /api/v1/conversations/export - Download the caller's conversations as
 *   JSONL (one conversation, with messages, per line).
 *
 * Same guard, user resolution and retention cutoff as the list endpoint, so a
 * user can only export their own conversations.
 */

import { createFileRoute } from '@tanstack/react-router'

import { debug, error, generateRequestId } from '@chm/logger'
import {
  createErrorResponse as createApiErrorResponse,
  createInternalErrorResponse,
} from '@/lib/api/error-handler'
import { CacheControl } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { retentionCutoffMs } from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { resolveUserId } from '@/lib/conversation-store/auth'
import { exportConversationsJsonl } from '@/lib/conversation-store/export'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { ConversationStoreError } from '@/lib/conversation-store/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT = { route: '/api/v1/conversations/export', method: 'GET' }

async function handleGet(): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/v1/conversations/export] Exporting', { requestId })

  try {
    await autoMigrate()

    if (!isFeatureEnabled('conversationDb')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Conversation storage is not enabled.',
          details: { timestamp: new Date().toISOString() },
        },
        501,
        ROUTE_CONTEXT
      )
    }

    const userId = await resolveUserId()

    // Same retention cutoff as the list endpoint (cloud/Clerk only).
    let sinceMs: number | undefined
    try {
      const owner = await resolveBillingOwner()
      const plan = await getPlanForOwner(owner.id)
      const cutoff = retentionCutoffMs(plan)
      if (cutoff != null) sinceMs = cutoff
    } catch {
      // Non-cloud / unauthenticated: no retention filter
    }

    const store = await resolveStore()
    const lines = exportConversationsJsonl(store, userId, { sinceMs })
    const encoder = new TextEncoder()

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await lines.next()
          if (next.done) controller.close()
          else controller.enqueue(encoder.encode(next.value))
        } catch (err) {
          error('[GET /api/v1/conversations/export] Stream error:', err, {
            requestId,
          })
          controller.error(err)
        }
      },
      async cancel() {
        await lines.return(undefined)
      },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="conversations-${stamp}.jsonl"`,
        'Cache-Control': CacheControl.NONE,
        'X-Request-ID': requestId,
      },
    })
  } catch (err) {
    error('[GET /api/v1/conversations/export] Error:', err, { requestId })

    if (err instanceof ConversationStoreError && err.code === 'UNAUTHORIZED') {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        403,
        ROUTE_CONTEXT
      )
    }
    return createInternalErrorResponse(err, ROUTE_CONTEXT, requestId)
  }
}

export const Route = createFileRoute('/api/v1/conversations/export')({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
})
