/**
 * Conversation backend info API endpoint
 * GET /api/v1/conversations/backend - Report the active conversation store
 *   backend and whether it supports AI enrichment.
 *
 * This endpoint returns no user data and therefore requires only the
 * conversationDb feature flag (no auth). It never leaks secrets — only the
 * backend kind and an AI-enrichment capability flag are returned.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error, generateRequestId } from '@chm/logger'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { AgentStateStore } from '@/lib/conversation-store/agentstate-store'
import { BrowserStore } from '@/lib/conversation-store/browser-store'
import { D1Store } from '@/lib/conversation-store/d1-store'
import { MemoryStore } from '@/lib/conversation-store/memory-store'
import { resolveStore } from '@/lib/conversation-store/resolve-store'
import { isConversationDbEnabled } from '@/lib/conversation-store/server-feature'

/**
 * Known conversation store backend identifiers.
 */
type BackendKind = 'browser' | 'd1' | 'postgres' | 'memory' | 'agentstate'

/**
 * Build a success response carrying the backend info.
 */
function backendResponse(
  backend: BackendKind,
  supportsAiEnrichment: boolean,
  requestId: string
): Response {
  const response = createSuccessResponse(
    { backend, supportsAiEnrichment },
    {
      queryId: 'conversation-backend',
      rows: 1,
    }
  )

  const headers = new Headers(response.headers)
  headers.set('X-Request-ID', requestId)
  headers.set('Cache-Control', CacheControl.NONE)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Handle GET requests reporting the active backend.
 */
async function handleGet(): Promise<Response> {
  const requestId = generateRequestId()

  try {
    // When persistence is disabled the BrowserStore (localStorage) is used.
    if (!isConversationDbEnabled()) {
      return backendResponse('browser', false, requestId)
    }

    const store = await resolveStore()

    let backend: BackendKind = 'postgres'
    if (store instanceof AgentStateStore) {
      backend = 'agentstate'
    } else if (store instanceof D1Store) {
      backend = 'd1'
    } else if (store instanceof BrowserStore) {
      backend = 'browser'
    } else if (store instanceof MemoryStore) {
      backend = 'memory'
    }

    const supportsAiEnrichment =
      backend === 'agentstate' && process.env.AGENTSTATE_AI_ENRICH === 'true'

    return backendResponse(backend, supportsAiEnrichment, requestId)
  } catch (err) {
    error('[GET /api/v1/conversations/backend] Error:', err, { requestId })
    // Fail safe: default to the browser (localStorage) backend.
    return backendResponse('browser', false, requestId)
  }
}

export const Route = createFileRoute('/api/v1/conversations/backend')({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
})
