/**
 * GET /api/v1/advisor/optimization-plan?host=0[&rewriteMBps=50]
 *
 * Recommend-only optimization plan (#4071) built from the findings the
 * advisors already stored. Reads the insights store only; nothing is applied.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, generateRequestId } from '@chm/logger'
import { buildOptimizationPlan } from '@/lib/ai/advisor/optimization-plan/build-plan'
import { createInternalErrorResponse } from '@/lib/api/error-handler/error-response-builder'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'

const ROUTE = '/api/v1/advisor/optimization-plan'

export const Route = createFileRoute('/api/v1/advisor/optimization-plan')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)
        const requestId = generateRequestId()
        const headers = { 'X-Request-ID': requestId }

        try {
          const searchParams = new URL(request.url).searchParams
          const hostId = parseHostIdParam(searchParams.get('host') ?? '0')
          if (!Number.isInteger(hostId)) {
            return Response.json(
              { error: 'Invalid host parameter: must be an integer' },
              { status: 400, headers }
            )
          }

          const rawMbps = searchParams.get('rewriteMBps')
          const rewriteMBps = rawMbps == null ? undefined : Number(rawMbps)
          if (
            rewriteMBps !== undefined &&
            !(Number.isFinite(rewriteMBps) && rewriteMBps > 0)
          ) {
            return Response.json(
              { error: 'rewriteMBps must be a positive number' },
              { status: 400, headers }
            )
          }

          if (await isDemoHostBlockedForRequest(hostId, bindings)) {
            return Response.json(
              { plan: null, unavailable: demoHiddenUnavailable() },
              { headers }
            )
          }

          const plan = await buildOptimizationPlan(hostId, { rewriteMBps })
          return Response.json({ plan }, { headers })
        } catch (err) {
          error(`[GET ${ROUTE}] Unexpected error:`, err, { requestId })
          return createInternalErrorResponse(
            err,
            { route: ROUTE, method: 'GET' },
            requestId
          )
        }
      },
    },
  },
})
