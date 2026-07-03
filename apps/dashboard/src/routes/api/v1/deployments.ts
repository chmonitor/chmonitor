/**
 * GET /api/v1/deployments — recent GitHub deployments for the query-volume
 * timeline overlay (plans/45-github-deploy-correlation.md). Reads from the
 * D1-backed store (lib/deployments/d1-store.ts) populated by
 * routes/api/v1/webhooks/github.ts.
 *
 * Query params (all optional): `sinceMs`, `untilMs` (unix milliseconds,
 * bound the `created_at` range shown by the overlay), `limit` (1-500,
 * default 100).
 *
 * Fails open: no `CHM_CLOUD_D1` binding or D1 error ⇒ `listDeployments`
 * resolves to `[]`, so this always 200s with an empty list rather than
 * erroring the chart overlay.
 */
import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { DEFAULT_DEPLOYMENT_SCOPE } from '@/lib/deployments/config'
import { listDeployments } from '@/lib/deployments/d1-store'

function parseOptionalNumber(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export const Route = createFileRoute('/api/v1/deployments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const searchParams = new URL(request.url).searchParams

        const sinceMs = parseOptionalNumber(searchParams.get('sinceMs'))
        const untilMs = parseOptionalNumber(searchParams.get('untilMs'))
        const limit = parseOptionalNumber(searchParams.get('limit'))

        try {
          const deployments = await listDeployments({
            ownerScope: DEFAULT_DEPLOYMENT_SCOPE,
            sinceMs,
            untilMs,
            limit,
          })

          return Response.json({ success: true, data: deployments })
        } catch (err) {
          // listDeployments is itself best-effort (returns [] on failure), so
          // this catch only guards against an unexpected throw elsewhere in
          // the handler — keep the overlay's contract of never erroring.
          logError('[GET /api/v1/deployments] Error:', err)
          return Response.json({ success: true, data: [] })
        }
      },
    },
  },
})
