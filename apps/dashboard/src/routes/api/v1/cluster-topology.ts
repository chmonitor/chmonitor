/**
 * Cluster topology API endpoint
 * GET /api/v1/cluster-topology?hostId=<n>
 *
 * Assembles the FULL topology model server-side from real ClickHouse data and
 * returns it as one cacheable JSON document the UI renders without recomputing.
 *
 * Data sources (each resilient & optional where appropriate):
 *  - system.clusters (clusters-topology)      → structural truth: clusters, shards,
 *                                                replicas, per-host errors/is_active.
 *                                                ALWAYS available (local view).
 *  - system.zookeeper_connection (keeper-presence) → coordination existence/liveness
 *                                                probe (broad version coverage).
 *  - system.zookeeper_info (keeper-info)       → rich per-Keeper-node enrichment
 *                                                (26.1+; optional, degrades to []).
 *  - clusterAllReplicas(view(...)) (cluster-live-metrics-all) → REAL per-node live
 *                                                CPU/mem/disk/queries for EVERY node.
 *                                                Best-effort: partially-down clusters
 *                                                return a subset (skip_unavailable_shards);
 *                                                a node with no live row is marked
 *                                                `unreachable` — never fabricated.
 *                                                On permission/readonly failure we fall
 *                                                back to the LOCAL node only.
 *
 * Caching: structure is slow-moving → Cache-Control: MEDIUM (s-maxage=60). The fast
 * (~8s) live tick stays a separate client SWR call so this document is not refetched
 * on every tick.
 *
 * SECURITY: No raw SQL is accepted from clients — only the pre-defined configs run.
 *
 * Ported from apps/dashboard/app/api/v1/cluster-topology/route.ts.
 * - `export const dynamic` is DROPPED (no Next route segment config in TSR).
 * - Per-route feature-permission auth (authorizeFeatureRequest) is DROPPED:
 *   it is centralized in middleware (#1397), matching merged routes.
 * - `bridgeClickHouseEnv(env)` runs before any fetchData (Workers env bridge).
 */

import { createFileRoute } from '@tanstack/react-router'

import type {
  ClusterLiveRow,
  KeeperInfoRow,
  KeeperPresenceRow,
  TopologyData,
} from '@/components/cluster-topology/model'
import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error, generateRequestId } from '@chm/logger'
import { assembleTopology } from '@/components/cluster-topology/model'
import { createErrorResponse } from '@/lib/api/error-handler'
import { HostIdSchema } from '@/lib/api/schemas'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'
import { keeperInfoConfig } from '@/lib/query-config/keeper/keeper-info'
import { keeperPresenceConfig } from '@/lib/query-config/keeper/keeper-presence'
import {
  clusterLiveMetricsAllConfig,
  clusterLiveMetricsConfig,
} from '@/lib/query-config/system/cluster-live-metrics'
import { clustersTopologyConfig } from '@/lib/query-config/system/clusters-topology'

const ROUTE_CONTEXT = { route: '/api/v1/cluster-topology', method: 'GET' }

/**
 * Pick the cluster to fan live metrics out over: the widest PHYSICAL cluster
 * (most members) so a single fan-out covers every host. Logical clusters reuse
 * the same hosts by name. Falls back to the cluster with the most members.
 */
function pickFanoutCluster(rows: ClusterTopologyRow[]): string | null {
  const counts = new Map<string, Set<string>>()
  const physical = new Set<string>()
  for (const r of rows) {
    if (!counts.has(r.cluster)) counts.set(r.cluster, new Set())
    counts.get(r.cluster)!.add(`${r.host_name}:${r.port}`)
    const n = r.cluster
    if (
      n === 'default' ||
      n.startsWith('default') ||
      n === 'all-replicated' ||
      n === 'all-sharded'
    ) {
      physical.add(n)
    }
  }
  let best: string | null = null
  let bestSize = -1
  // Prefer physical clusters; among them the widest.
  for (const [name, hosts] of counts) {
    const isPhysical = physical.has(name)
    const size = hosts.size + (isPhysical ? 10_000 : 0)
    if (size > bestSize) {
      bestSize = size
      best = name
    }
  }
  return best
}

async function handleGet(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)

    const hostIdResult = HostIdSchema.safeParse(
      searchParams.get('hostId') ?? '0'
    )
    if (!hostIdResult.success) {
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid hostId parameter: must be a non-negative integer',
        },
        400,
        ROUTE_CONTEXT
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }
    const hostId = hostIdResult.data
    const timezone = searchParams.get('timezone') || undefined

    // Cloud demo-hiding invariant (#2172 / #2488): reject a non-negative
    // hostId for an authenticated cloud principal (the hidden env/demo host).
    if (
      await isDemoHostBlockedForRequest(
        hostId,
        env as Record<string, string | undefined>
      )
    ) {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      headers.set('X-Request-ID', requestId)
      return Response.json(
        {
          success: true,
          data: null,
          metadata: {
            queryId: 'cluster-topology',
            duration: 0,
            rows: 0,
            host: String(hostId),
            unavailable: demoHiddenUnavailable(),
          },
        },
        { headers }
      )
    }

    debug('[GET /api/v1/cluster-topology] Assembling topology', {
      requestId,
      hostId,
    })

    // Keeper presence + info (steps 2 & 3) don't depend on the structural rows,
    // so kick them off now to overlap with the structural query below instead of
    // serializing behind it. They're optional and must never fail the batch.
    const presencePromise = fetchData<KeeperPresenceRow[]>({
      query: '',
      hostId,
      format: 'JSONEachRow',
      queryConfig: keeperPresenceConfig,
    }).catch(() => ({ data: [], error: undefined }) as never)
    const keeperPromise = fetchData<KeeperInfoRow[]>({
      query: '',
      hostId,
      format: 'JSONEachRow',
      queryConfig: keeperInfoConfig,
    }).catch(() => ({ data: [], error: undefined }) as never)

    // ── 1. STRUCTURAL truth (must succeed) ──
    const structural = await fetchData<ClusterTopologyRow[]>({
      query: '',
      hostId,
      format: 'JSONEachRow',
      queryConfig: clustersTopologyConfig,
      ...(timezone
        ? { clickhouse_settings: { session_timezone: timezone } }
        : {}),
    })

    if (structural.error) {
      error(
        '[GET /api/v1/cluster-topology] Structural query failed',
        undefined,
        {
          requestId,
          message: structural.error.message,
        }
      )
      const errorResponse = createErrorResponse(
        {
          type: structural.error.type as ApiErrorType,
          message: structural.error.message,
        },
        500,
        { ...ROUTE_CONTEXT, hostId }
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    const clusterRows = (structural.data ?? []) as ClusterTopologyRow[]

    // ── 2 & 3. Keeper presence + info (started above; awaited here) ──
    const [presenceResult, keeperResult] = await Promise.all([
      presencePromise,
      keeperPromise,
    ])

    const presenceRows = (
      presenceResult.error ? [] : (presenceResult.data ?? [])
    ) as KeeperPresenceRow[]
    const keeperRows = (
      keeperResult.error ? [] : (keeperResult.data ?? [])
    ) as KeeperInfoRow[]

    // ── 4. Live metrics: fan out across the widest physical cluster ──
    let liveRows: ClusterLiveRow[] = []
    let liveSource: TopologyData['meta']['liveSource'] = 'none'

    const fanoutCluster = pickFanoutCluster(clusterRows)
    if (fanoutCluster) {
      const fanout = await fetchData<ClusterLiveRow[]>({
        query: '',
        hostId,
        format: 'JSONEachRow',
        queryConfig: clusterLiveMetricsAllConfig,
        query_params: { cluster: fanoutCluster },
      }).catch(
        () => ({ data: null, error: { message: 'fanout threw' } }) as never
      )

      if (
        !fanout.error &&
        Array.isArray(fanout.data) &&
        fanout.data.length > 0
      ) {
        liveRows = fanout.data as ClusterLiveRow[]
        liveSource = 'fanout'
      }
    }

    // Fallback: cluster fan-out not permitted (readonly / missing grant) or empty
    // → local-only live metrics for the connected node. Remote nodes then render
    // structural state only (errors / is_active), never fabricated numbers.
    if (liveSource === 'none') {
      const local = await fetchData<ClusterLiveRow[]>({
        query: '',
        hostId,
        format: 'JSONEachRow',
        queryConfig: clusterLiveMetricsConfig,
      }).catch(
        () => ({ data: null, error: { message: 'local threw' } }) as never
      )
      if (!local.error && Array.isArray(local.data) && local.data.length > 0) {
        liveRows = local.data as ClusterLiveRow[]
        liveSource = 'local'
      }
    }

    // ── 5. Assemble (pure, layout-free) ──
    const data: TopologyData = assembleTopology(
      clusterRows,
      keeperRows,
      presenceRows,
      liveRows,
      liveSource
    )

    debug('[GET /api/v1/cluster-topology] Assembled', {
      requestId,
      chNodes: data.meta.counts.chNodes,
      keepers: data.meta.counts.keepers,
      clusters: data.meta.counts.clusters,
      keeperSource: data.keeper.source,
      liveSource,
    })

    const response = createSuccessResponse<TopologyData>(data, {
      queryId: 'cluster-topology',
      rows: data.meta.counts.nodes,
      duration: Number(structural.metadata?.duration ?? 0),
    })
    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)
    headers.set('Cache-Control', CacheControl.MEDIUM)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    error('[GET /api/v1/cluster-topology] Unexpected error', err, { requestId })
    const errorResponse = createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
      ROUTE_CONTEXT
    )
    const headers = new Headers(errorResponse.headers)
    headers.set('X-Request-ID', requestId)
    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers,
    })
  }
}

export const Route = createFileRoute('/api/v1/cluster-topology')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})
