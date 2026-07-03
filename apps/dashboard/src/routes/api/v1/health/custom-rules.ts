/**
 * Custom alert rules API (plan 32)
 * GET  /api/v1/health/custom-rules — list (owner-scoped)
 * POST /api/v1/health/custom-rules — create (whitelisted metric/op/thresholds only)
 *
 * No free-form SQL field exists anywhere in this route — `metric` must be a
 * key in `METRIC_CATALOG` (rule-builder-schema.ts); anything else is
 * rejected with 400 before it ever reaches D1.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { CustomAlertRule } from '@/lib/health/custom-rules-store'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { mapCustomRuleApiError } from '@/lib/health/custom-rules-api-errors'
import { resolveCustomRuleOwnerId } from '@/lib/health/custom-rules-auth'
import {
  createCustomRule,
  listCustomRules,
} from '@/lib/health/custom-rules-store'
import { METRIC_CATALOG } from '@/lib/health/rule-builder-schema'

const ROUTE_GET = { route: '/api/v1/health/custom-rules', method: 'GET' }
const ROUTE_POST = { route: '/api/v1/health/custom-rules', method: 'POST' }

function toPublicRule(rule: CustomAlertRule) {
  return {
    id: rule.id,
    name: rule.name,
    metric: rule.metric,
    op: rule.op,
    warning: rule.warning,
    critical: rule.critical,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
  }
}

async function handleGet(): Promise<Response> {
  try {
    const ownerId = await resolveCustomRuleOwnerId()
    const rules = await listCustomRules(ownerId)
    return createSuccessResponse(rules.map(toPublicRule))
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_GET)
  }
}

interface CreateRequest {
  name?: unknown
  metric?: unknown
  op?: unknown
  warning?: unknown
  critical?: unknown
}

async function handlePost(request: Request): Promise<Response> {
  let body: CreateRequest
  try {
    body = (await request.json()) as CreateRequest
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

  try {
    const ownerId = await resolveCustomRuleOwnerId()
    // `createCustomRule` runs the zod schema (rejects off-catalog metrics,
    // non-numeric thresholds, empty names) AND compiles + deny-list-checks
    // the resulting SQL before anything touches D1.
    const created = await createCustomRule(ownerId, body as never)
    return createSuccessResponse(toPublicRule(created), undefined, 201)
  } catch (error) {
    return mapCustomRuleApiError(error, ROUTE_POST)
  }
}

/** GET-only: the whitelisted metric catalog, for the builder dropdown. */
async function handleGetCatalog(): Promise<Response> {
  const catalog = Object.entries(METRIC_CATALOG).map(([key, entry]) => ({
    key,
    label: entry.label,
    unit: entry.unit,
  }))
  return createSuccessResponse(catalog)
}

export const Route = createFileRoute('/api/v1/health/custom-rules')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('catalog') === '1') {
          return handleGetCatalog()
        }
        return handleGet()
      },
      POST: async ({ request }) => handlePost(request),
    },
  },
})
