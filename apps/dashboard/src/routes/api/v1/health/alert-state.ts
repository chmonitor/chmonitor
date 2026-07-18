/**
 * Current alert state endpoint (#2767)
 * GET /api/v1/health/alert-state?hostId=0
 *
 * Returns the health sweep's persisted last-known state per (check, host) from
 * the `alert_state` D1 table — the confirmed severity, when it last transitioned
 * (`updatedAt`), when the incident began firing (`firstFiredAt`), and any
 * in-flight hysteresis streak (`pendingSeverity`/`pendingCount`). Powers the
 * "Current alert state" card in Alert Settings.
 *
 * Auth is centralized in middleware, same as the sibling /api/v1/health/*
 * routes. `host_id` indexes the operator's env-configured hosts only (the sweep
 * never touches per-user D1 connections), so there is no per-row tenant scoping.
 *
 * The underlying store is best-effort: it degrades to `[]` rather than throwing
 * when D1 isn't configured (self-hosted/OSS default), so this route always
 * returns 200 with a (possibly empty) `states` array.
 */

import { createFileRoute } from '@tanstack/react-router'

import { readAlertStates } from '@/lib/health/alert-state-persist'

export const Route = createFileRoute('/api/v1/health/alert-state')({
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

        const states = await readAlertStates(hostId)
        return Response.json({ success: true, states })
      },
    },
  },
})
