/**
 * Notifications API endpoint
 * GET /api/v1/notifications?hostId=n
 *
 * Returns active alerts across all clusters.
 * Currently: readonly-tables warnings (via clusterAllReplicas on system.replicas).
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

// ---------------------------------------------------------------------------
// Env helpers (mirrors healthz.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Notification {
  readonly type: 'readonly-tables'
  readonly cluster: string
  readonly count: number
  readonly severity: 'critical' | 'warning'
}

interface NotificationsResponse {
  readonly notifications: readonly Notification[]
  readonly totalCount: number
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/v1/notifications')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const rawHostId = url.searchParams.get('hostId') ?? '0'
        const hostId = Number(rawHostId)

        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              error: 'Invalid hostId parameter: must be a non-negative integer',
            },
            { status: 400 }
          )
        }

        const bindings = env as Record<string, string | undefined>

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          const body = {
            success: true,
            data: {
              notifications: [],
              totalCount: 0,
            } satisfies NotificationsResponse,
            unavailable: {
              reason: 'demo_hidden',
              message: 'The demo host is hidden for signed-in accounts.',
            },
          }
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const configs = getClickHouseConfigsFromEnv(bindings)

        if (configs.length === 0) {
          return Response.json(
            { error: 'No ClickHouse hosts configured' },
            { status: 503 }
          )
        }

        const clientConfig = configs[hostId]
        if (!clientConfig) {
          return Response.json(
            {
              error: `Invalid hostId: ${hostId}. Available host indices: 0–${configs.length - 1}`,
            },
            { status: 400 }
          )
        }

        try {
          const client = await getClient({ web: true, clientConfig })

          // Step 1: get all clusters
          const clustersResult = await client.query({
            query: `
              SELECT DISTINCT cluster
              FROM system.clusters
              ORDER BY cluster ASC
            `,
            format: 'JSONEachRow',
          })
          const clusters = (await clustersResult.json()) as Array<{
            cluster: string
          }>

          // Step 2: for each cluster check readonly replica count.
          // Clusters are independent — fan out concurrently. Each query is
          // best-effort: a failing cluster yields null and is skipped, so one
          // failure never rejects the whole batch. Result order matches the
          // cluster order (Promise.all preserves input order).
          const perCluster = await Promise.all(
            clusters.map(async ({ cluster }) => {
              try {
                const readonlyResult = await client.query({
                  query: `
                  SELECT COUNT() as count
                  FROM clusterAllReplicas({cluster: String}, system.replicas)
                  WHERE is_readonly = 1
                `,
                  format: 'JSONEachRow',
                  query_params: { cluster },
                })
                const readonlyData = (await readonlyResult.json()) as Array<{
                  count?: number | string
                }>
                const readonlyCount =
                  readonlyData.length > 0 && readonlyData[0].count !== undefined
                    ? Number(readonlyData[0].count)
                    : 0

                if (readonlyCount > 0) {
                  return {
                    type: 'readonly-tables',
                    cluster,
                    count: readonlyCount,
                    severity: readonlyCount > 10 ? 'critical' : 'warning',
                  } satisfies Notification
                }
                return null
              } catch {
                // Skip clusters that don't support this query
                return null
              }
            })
          )

          const notifications: Notification[] = perCluster.filter(
            (n): n is Notification => n !== null
          )

          const totalCount = notifications.length
          const body = {
            success: true,
            data: { notifications, totalCount } satisfies NotificationsResponse,
          }

          return new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              // Short cache — 30 seconds, matching the source route
              'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
            },
          })
        } catch (err) {
          return Response.json(
            {
              error: err instanceof Error ? err.message : 'Unknown error',
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
