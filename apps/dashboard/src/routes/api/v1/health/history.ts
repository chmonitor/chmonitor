/**
 * Alert history (audit log) endpoint
 * GET /api/v1/health/history?hostId=0&day=2026-07-01&limit=50
 *
 * Returns recent rows from the `alert_events` D1 table — one row per attempted
 * webhook delivery from the health sweep's notify decision (see
 * `lib/health/server-sweep.ts` + `lib/health/alert-history-store.ts`). All
 * query params are optional: omitting `hostId` returns events across every
 * host, omitting `day` returns the most recent events regardless of date.
 *
 * Auth is centralized in middleware (#1397), same as the sibling
 * /api/v1/health/* routes (checks.ts, snapshot.ts) — this handler only
 * validates input and shapes the response. No per-row owner/tenant scoping:
 * `host_id` indexes the operator's env-configured hosts only (the sweep never
 * touches per-user D1 connections), so every caller allowed to reach this
 * route already sees the same host set as the other health routes.
 *
 * The underlying store is best-effort — it degrades to `[]` rather than
 * throwing when D1 isn't configured (self-hosted/OSS default), so this route
 * always returns 200 with an (possibly empty) events array rather than a 5xx.
 */

import { createFileRoute } from '@tanstack/react-router'

import { queryAlertEvents } from '@/lib/health/alert-history-store'

/** `YYYY-MM-DD` — matches the store's date-prefix filter contract exactly. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute('/api/v1/health/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url)

        let hostId: number | undefined
        const hostIdParam = searchParams.get('hostId')
        if (hostIdParam !== null && hostIdParam !== '') {
          const parsed = Number(hostIdParam)
          if (!Number.isInteger(parsed) || parsed < 0) {
            return Response.json(
              {
                success: false,
                error: { type: 'validation', message: 'Invalid hostId' },
              },
              { status: 400 }
            )
          }
          hostId = parsed
        }

        let day: string | undefined
        const dayParam = searchParams.get('day')
        if (dayParam !== null && dayParam !== '') {
          if (!DAY_PATTERN.test(dayParam)) {
            return Response.json(
              {
                success: false,
                error: {
                  type: 'validation',
                  message: 'Invalid day: expected YYYY-MM-DD',
                },
              },
              { status: 400 }
            )
          }
          day = dayParam
        }

        let limit: number | undefined
        const limitParam = searchParams.get('limit')
        if (limitParam !== null && limitParam !== '') {
          const parsed = Number(limitParam)
          if (!Number.isInteger(parsed) || parsed <= 0) {
            return Response.json(
              {
                success: false,
                error: { type: 'validation', message: 'Invalid limit' },
              },
              { status: 400 }
            )
          }
          limit = parsed
        }

        const events = await queryAlertEvents({ hostId, day, limit })

        return Response.json(
          { success: true, events },
          {
            status: 200,
            headers: {
              'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
            },
          }
        )
      },
    },
  },
})
