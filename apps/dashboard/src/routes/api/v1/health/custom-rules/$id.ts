/**
 * Custom alert rule by ID (plan 32)
 * DELETE /api/v1/health/custom-rules/$id
 */

import { createFileRoute } from '@tanstack/react-router'

import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { mapCustomRuleApiError } from '@/lib/health/custom-rules-api-errors'
import { resolveCustomRuleOwnerId } from '@/lib/health/custom-rules-auth'
import { deleteCustomRule } from '@/lib/health/custom-rules-store'

const ROUTE_DELETE = {
  route: '/api/v1/health/custom-rules/$id',
  method: 'DELETE',
}

async function handleDelete(ruleId: string): Promise<Response> {
  try {
    const ownerId = await resolveCustomRuleOwnerId()
    await deleteCustomRule(ownerId, ruleId)
    return createSuccessResponse({ deleted: true })
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_DELETE)
  }
}

export const Route = createFileRoute('/api/v1/health/custom-rules/$id')({
  server: {
    handlers: {
      DELETE: async ({ params }) => handleDelete(params.id),
    },
  },
})
