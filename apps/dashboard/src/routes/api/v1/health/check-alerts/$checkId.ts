/**
 * One built-in health check alert (#3438)
 * PUT    /api/v1/health/check-alerts/$checkId  { "name": "…" } — name / rename
 * DELETE /api/v1/health/check-alerts/$checkId                 — reset to default
 *
 * `$checkId` must be a known `HealthCheckDef.id` (404 otherwise). The alert's
 * `ruleId` stays the check id, so renaming never resets ACKs or history.
 * No metadata DB ⇒ 501, the same mapping as the custom-rules routes.
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  renameCheckAlert,
  resetCheckAlert,
} from '@/lib/health/check-alerts-store'
import { mapCustomRuleApiError } from '@/lib/health/custom-rules-api-errors'
import { resolveCustomRuleOwnerId } from '@/lib/health/custom-rules-auth'

const ROUTE = '/api/v1/health/check-alerts/$checkId'
const ROUTE_PUT = { route: ROUTE, method: 'PUT' }
const ROUTE_DELETE = { route: ROUTE, method: 'DELETE' }

async function handlePut(checkId: string, request: Request): Promise<Response> {
  let body: { name?: unknown }
  try {
    body = (await request.json()) as { name?: unknown }
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_PUT
    )
  }

  try {
    const ownerId = await resolveCustomRuleOwnerId()
    return createSuccessResponse(
      await renameCheckAlert(ownerId, checkId, body?.name)
    )
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_PUT)
  }
}

async function handleDelete(checkId: string): Promise<Response> {
  try {
    const ownerId = await resolveCustomRuleOwnerId()
    return createSuccessResponse(await resetCheckAlert(ownerId, checkId))
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_DELETE)
  }
}

export {
  handleDelete as __handleDeleteForTests,
  handlePut as __handlePutForTests,
}

export const Route = createFileRoute('/api/v1/health/check-alerts/$checkId')({
  server: {
    handlers: {
      PUT: async ({ params, request }) => handlePut(params.checkId, request),
      DELETE: async ({ params }) => handleDelete(params.checkId),
    },
  },
})
