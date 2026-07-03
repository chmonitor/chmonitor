/**
 * Inbound Events list — GET /api/events?source=&severity=&sinceMs=&limit=
 *
 * Reads the `event_log` D1 table populated by the ingest route / queue
 * consumer (see lib/events/event-store.ts). Feeds the "Inbound Events"
 * dashboard page. Returns an empty list (never an error) when CHM_CLOUD_D1 is
 * unbound — the normal self-host/local-dev state.
 *
 * Read access mirrors other health/alerting data: public in the cloud demo,
 * authenticated otherwise (same posture as /api/v1/health/checks).
 */

import { createFileRoute } from '@tanstack/react-router'

import { listEvents } from '@/lib/events/event-store'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

async function handleGet(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'health', defaultAccess: 'public', operation: 'read' },
    request
  )
  if (permissionResponse) return permissionResponse

  const url = new URL(request.url)
  const source = url.searchParams.get('source') ?? undefined
  const severity = url.searchParams.get('severity') ?? undefined
  const sinceMsRaw = url.searchParams.get('sinceMs')
  const limitRaw = url.searchParams.get('limit')

  const sinceMs = sinceMsRaw ? Number(sinceMsRaw) : undefined
  const limit = limitRaw ? Number(limitRaw) : undefined

  const events = await listEvents({
    source,
    severity,
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  })

  return Response.json({ success: true, data: events }, { status: 200 })
}

export const Route = createFileRoute('/api/events/')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests }
