/**
 * Built-in health check alerts (#3438)
 * GET /api/v1/health/check-alerts — every known check with its display name
 *
 * Always answers with the full list: with no metadata DB each entry carries
 * its default title and `source: 'default'` (read-only — gate writes on
 * `capabilities.health.backend` from `/api/v1/config`). Rename / reset live
 * on `check-alerts/$checkId`.
 */

import { createFileRoute } from '@tanstack/react-router'

import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { listCheckAlerts } from '@/lib/health/check-alerts-store'
import { mapCustomRuleApiError } from '@/lib/health/custom-rules-api-errors'
import { resolveCustomRuleOwnerId } from '@/lib/health/custom-rules-auth'

const ROUTE_GET = { route: '/api/v1/health/check-alerts', method: 'GET' }

async function handleGet(): Promise<Response> {
  try {
    const ownerId = await resolveCustomRuleOwnerId()
    return createSuccessResponse(await listCheckAlerts(ownerId))
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_GET)
  }
}

export { handleGet as __handleGetForTests }

export const Route = createFileRoute('/api/v1/health/check-alerts')({
  server: {
    handlers: {
      GET: async () => handleGet(),
    },
  },
})
