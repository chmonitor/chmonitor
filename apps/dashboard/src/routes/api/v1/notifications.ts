/**
 * Notifications API endpoint
 * GET /api/v1/notifications?hostId=n
 *
 * Returns active alerts across all clusters.
 * Currently: readonly-tables warnings (via clusterAllReplicas on system.replicas).
 *
 * #3682 — this route was the 163-queries-a-day site. It fanned out one
 * `clusterAllReplicas` per cluster name per request, and on a deployment where
 * inter-server auth rejects the monitoring user every one of those failed with
 * `516 Authentication failed`, was swallowed by a bare `catch`, and was retried
 * on the next 30-second poll. It now goes through the shared cluster-fanout
 * capability (`lib/health/cluster-fanout.ts`), which:
 *
 *  - picks ONE cluster from the cached `system.clusters` list instead of all of
 *    them, so the count scales with poll frequency rather than cluster count;
 *  - stops retrying a cluster that rejects inter-server auth, with exponential
 *    backoff up to a 6-hour ceiling (see that module for why not "sticky
 *    forever" and not a flat TTL);
 *  - reports the degradation in the response body
 *    (`clusterViewUnavailable`) so the UI says "cluster-wide view unavailable:
 *    inter-server auth" once instead of silently showing a local-only count.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { sanitizeDbQueryError } from '@/lib/api/error-handler/sanitize-error'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import {
  clusterViewNotice,
  getClusterFanout,
} from '@/lib/health/cluster-fanout'

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

/**
 * The `data` payload every 200 response carries, healthy or degraded.
 *
 * Exported so the route-level test can type its assertion against the real
 * shape instead of hand-writing one. #3682 added a field and a duplicated
 * inline annotation in the test is exactly what let the two drift into a
 * `TS2769` failure.
 */
export interface NotificationsResponse {
  readonly notifications: readonly Notification[]
  readonly totalCount: number
  /**
   * Why the cluster-wide view is degraded, or `null` when it is healthy.
   * `cluster: null` means "could not even read the capability snapshot".
   *
   * This is the issue's "surface it once instead of silently degrading": the
   * counts below are node-local when this is set, and an operator reading a
   * readonly-tables count of 0 has no other way to tell that from "the whole
   * cluster is fine".
   */
  readonly clusterViewUnavailable: {
    readonly reason: string
    readonly message: string
    readonly cluster: string | null
    readonly nextRetryAt: string
  } | null
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
              // The demo host is hidden outright, so there is no cluster-wide
              // view to degrade — nothing for a client to warn about.
              clusterViewUnavailable: null,
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

          // Step 1 (#3682): can this user fan out to a cluster at all? Reads the
          // cached capability snapshot and probes at most once per TTL (or once
          // per backoff window, for a cluster that rejects inter-server auth).
          // This replaces the per-request `SELECT DISTINCT cluster FROM
          // system.clusters` plus one doomed `clusterAllReplicas` per name.
          const fanout = await getClusterFanout(hostId)
          const clusterViewUnavailable = clusterViewNotice(fanout)

          // Step 2: readonly replica count.
          //
          // When the fan-out is unavailable we fall back to THIS node's
          // `system.replicas`, which is what the number used to be whenever a
          // cluster silently failed. That is strictly better than reporting
          // nothing — and `clusterViewUnavailable` is what tells the operator
          // the number is node-local rather than cluster-wide.
          const notifications: Notification[] = []
          let clusterLabel = fanout.cluster ?? 'local'

          if (fanout.status === 'supported' && fanout.cluster !== null) {
            const readonlyResult = await client.query({
              query: `
              SELECT COUNT() as count
              FROM clusterAllReplicas({cluster: String}, system.replicas)
              WHERE is_readonly = 1
            `,
              format: 'JSONEachRow',
              query_params: { cluster: fanout.cluster },
            })
            const readonlyData = (await readonlyResult.json()) as Array<{
              count?: number | string
            }>
            const readonlyCount =
              readonlyData.length > 0 && readonlyData[0].count !== undefined
                ? Number(readonlyData[0].count)
                : 0
            if (readonlyCount > 0) {
              notifications.push({
                type: 'readonly-tables',
                cluster: fanout.cluster,
                count: readonlyCount,
                severity: readonlyCount > 10 ? 'critical' : 'warning',
              })
            }
          } else {
            // Node-local fallback. `clusterLabel` says so, so the notification
            // text cannot be read as a cluster-wide count.
            clusterLabel = `${clientConfig.customName || 'this node'} (local only)`
            const localResult = await client.query({
              query: `
                SELECT COUNT() as count
                FROM system.replicas
                WHERE is_readonly = 1
              `,
              format: 'JSONEachRow',
            })
            const localData = (await localResult.json()) as Array<{
              count?: number | string
            }>
            const localCount =
              localData.length > 0 && localData[0].count !== undefined
                ? Number(localData[0].count)
                : 0
            if (localCount > 0) {
              notifications.push({
                type: 'readonly-tables',
                cluster: clusterLabel,
                count: localCount,
                severity: localCount > 10 ? 'critical' : 'warning',
              })
            }
          }

          const totalCount = notifications.length
          const body = {
            success: true,
            data: {
              notifications,
              totalCount,
              clusterViewUnavailable: clusterViewUnavailable
                ? {
                    reason: fanout.status,
                    message: clusterViewUnavailable,
                    cluster: fanout.cluster,
                    nextRetryAt: new Date(fanout.nextProbeAt).toISOString(),
                  }
                : null,
            } satisfies NotificationsResponse,
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
          error('[GET /api/v1/notifications] Handler error', err as Error)
          return Response.json(
            {
              error:
                err instanceof Error
                  ? sanitizeDbQueryError(err.message)
                  : 'Unknown error',
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
