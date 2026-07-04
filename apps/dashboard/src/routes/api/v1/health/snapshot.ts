/**
 * Incident system-snapshot endpoint
 * GET /api/v1/health/snapshot?hostId=0
 *
 * Returns a compact, point-in-time picture of a host's runtime state (top
 * running queries, active/stuck merges, memory + disk usage %, replication
 * lag) for attaching context to an incident/alert.
 *
 * Auth is centralized in middleware (#1397), same as the sibling
 * /api/v1/health/* routes — this handler only validates input and shapes the
 * response. The underlying snapshot is best-effort: individual fields may be
 * null when their query fails, but the request still succeeds.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { captureIncidentSnapshot } from '@/lib/health/incident-snapshot'

export const Route = createFileRoute('/api/v1/health/snapshot')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url)

        const hostId = Number(searchParams.get('hostId') ?? '0')
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              error: { type: 'validation', message: 'Invalid hostId' },
            },
            { status: 400 }
          )
        }

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        const bindings = env as Record<string, string | undefined>
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          return Response.json(
            {
              success: true,
              snapshot: null,
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            },
            {
              status: 200,
              headers: {
                'Cache-Control':
                  'public, s-maxage=5, stale-while-revalidate=15',
              },
            }
          )
        }

        try {
          const snapshot = await captureIncidentSnapshot(hostId)
          return Response.json(
            { success: true, snapshot },
            {
              status: 200,
              headers: {
                'Cache-Control':
                  'public, s-maxage=5, stale-while-revalidate=15',
              },
            }
          )
        } catch (err) {
          error('[GET /api/v1/health/snapshot]', err)
          return Response.json(
            {
              success: false,
              error: {
                type: 'query_error',
                message: err instanceof Error ? err.message : 'Unknown error',
              },
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
