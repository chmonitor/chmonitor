/**
 * Smart alert-rule suggestions API (issue #2667).
 *
 *   GET  /api/v1/health/alert-suggestions        — compute (cached) the current
 *        suggestions for the caller, minus anything they've dismissed.
 *   POST /api/v1/health/alert-suggestions        — body `{ action }`:
 *        - `{ action: 'accept', name, metric, op, warning, critical }`
 *          → creates a custom rule via custom-rules-store (SAME path the rule
 *            builder uses); inline-edited thresholds flow straight through.
 *        - `{ action: 'dismiss', key }`
 *          → persists the dismissal so the suggestion stays hidden.
 *
 * There is NO free-form SQL anywhere: `metric` must be a `METRIC_CATALOG` key,
 * validated + compiled by `createCustomRule` before it ever reaches D1.
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  dismissSuggestion,
  SuggestionDismissalStoreError,
} from '@/lib/health/alert-suggestion-dismissals-store'
import {
  computeAlertSuggestions,
  invalidateAlertSuggestionsCache,
} from '@/lib/health/alert-suggestions-compute'
import { mapCustomRuleApiError } from '@/lib/health/custom-rules-api-errors'
import { resolveCustomRuleOwnerId } from '@/lib/health/custom-rules-auth'
import { createCustomRule } from '@/lib/health/custom-rules-store'

const ROUTE_GET = { route: '/api/v1/health/alert-suggestions', method: 'GET' }
const ROUTE_POST = { route: '/api/v1/health/alert-suggestions', method: 'POST' }

async function handleGet(): Promise<Response> {
  try {
    const ownerId = await resolveCustomRuleOwnerId()
    const suggestions = await computeAlertSuggestions(ownerId)
    return createSuccessResponse(suggestions)
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_GET)
  }
}

interface PostBody {
  action?: unknown
  // accept
  name?: unknown
  metric?: unknown
  op?: unknown
  warning?: unknown
  critical?: unknown
  // dismiss
  key?: unknown
}

async function handleAccept(
  ownerId: string,
  body: PostBody
): Promise<Response> {
  // `createCustomRule` runs the zod schema (rejects off-catalog metrics,
  // non-numeric thresholds, empty names) AND compiles + deny-list-checks the
  // resulting SQL before anything touches D1.
  const created = await createCustomRule(ownerId, body as never)
  invalidateAlertSuggestionsCache(ownerId)
  return createSuccessResponse(
    { accepted: true, rule: created },
    undefined,
    201
  )
}

async function handleDismiss(
  ownerId: string,
  body: PostBody
): Promise<Response> {
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  if (!key) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: '"key" is required to dismiss a suggestion',
      },
      400,
      ROUTE_POST
    )
  }
  await dismissSuggestion(ownerId, key)
  invalidateAlertSuggestionsCache(ownerId)
  return createSuccessResponse({ dismissed: true, key })
}

async function handlePost(request: Request): Promise<Response> {
  let body: PostBody
  try {
    body = (await request.json()) as PostBody
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_POST
    )
  }

  const action = body.action
  if (action !== 'accept' && action !== 'dismiss') {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: '"action" must be "accept" or "dismiss"',
      },
      400,
      ROUTE_POST
    )
  }

  try {
    const ownerId = await resolveCustomRuleOwnerId()
    return action === 'accept'
      ? await handleAccept(ownerId, body)
      : await handleDismiss(ownerId, body)
  } catch (error) {
    if (error instanceof SuggestionDismissalStoreError) {
      return createApiErrorResponse(
        { type: ApiErrorType.PermissionError, message: error.message },
        error.code === 'NOT_CONFIGURED' ? 501 : 500,
        ROUTE_POST
      )
    }
    return mapCustomRuleApiError(error, ROUTE_POST)
  }
}

export const Route = createFileRoute('/api/v1/health/alert-suggestions')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})
