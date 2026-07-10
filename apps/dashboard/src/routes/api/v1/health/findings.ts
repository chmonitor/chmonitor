/**
 * Current findings snapshot endpoint (plan 29)
 * GET /api/v1/health/findings
 *
 * Feeds the Active Alerts panel: currently-firing conditions across every
 * configured host, computed read-only (no dispatch, no dedup-state writes —
 * see `lib/health/current-findings.ts`). Auth is centralized in middleware
 * (#1397), same as the sibling /api/v1/health/* GET routes (history,
 * snapshot, checks).
 */

import { createFileRoute } from '@tanstack/react-router'

import { error } from '@chm/logger'
import { sanitizeClickHouseError } from '@/lib/api/error-handler/sanitize-error'
import { getCurrentFindings } from '@/lib/health/current-findings'

export const Route = createFileRoute('/api/v1/health/findings')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const findings = await getCurrentFindings()
          return Response.json(
            { success: true, findings },
            {
              status: 200,
              headers: {
                'Cache-Control':
                  'public, s-maxage=5, stale-while-revalidate=15',
              },
            }
          )
        } catch (err) {
          error('[GET /api/v1/health/findings]', err)
          return Response.json(
            {
              success: false,
              error: {
                type: 'query_error',
                message: sanitizeClickHouseError(
                  err instanceof Error ? err.message : 'Unknown error'
                ),
              },
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
