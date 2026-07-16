import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { getClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import { error } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import {
  classifyError,
  getStatusCodeForErrorType,
} from '@/lib/api/error-handler'
import { runWithQueryCache } from '@/lib/api/query-cache-settings'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

const QUERY_COMMENT = '/* { "client": "clickhouse-monitoring" } */\n'

/**
 * TTL (seconds) for the ClickHouse query cache on the host-status probe
 * (#2182) — mirrors `useHostStatus`'s default 60s poll interval
 * (lib/swr/use-host-status.ts).
 */
const HOST_STATUS_CACHE_TTL_SECONDS = 60

export const Route = createFileRoute('/api/v1/host-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const searchParams = new URL(request.url).searchParams
        const hostIdRaw = searchParams.get('hostId')
        // Opt-in: the Fleet table asks for extra cross-host comparison counts
        // (databases/tables/cluster nodes). Off by default so the widely-polled
        // status probe (host switcher, logo indicator, cards) stays a single
        // round-trip for every other consumer.
        const wantCounts = searchParams.get('counts') === '1'

        if (hostIdRaw === null || hostIdRaw === '') {
          return Response.json(
            { success: false, error: 'hostId query parameter is required' },
            { status: 400 }
          )
        }

        const hostId = Number(hostIdRaw)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            { success: false, error: 'hostId must be a non-negative integer' },
            { status: 400 }
          )
        }

        const bindings = env as Record<string, string | undefined>

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          return Response.json({
            success: true,
            data: { version: '', uptime: '', hostname: '' },
            metadata: {
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            },
          })
        }

        const configs = getClickHouseConfigsFromEnv(bindings)

        if (hostId >= configs.length) {
          return Response.json(
            {
              success: false,
              error: `hostId ${hostId} is out of range (${configs.length} host(s) configured)`,
            },
            { status: 400 }
          )
        }

        const clientConfig = configs[hostId]

        try {
          const client = await getClient({ web: true, clientConfig })

          // Read-only GET path: safe to opt into the ClickHouse query cache
          // (#2182). bridgeClickHouseEnv makes process.env consistent with
          // the `bindings`-derived clientConfig above, so getClickHouseVersion
          // (cached 24h per host) resolves the same host.
          bridgeClickHouseEnv(bindings)
          const cacheOpts = {
            version: await getClickHouseVersion(hostId),
            ttlSeconds: HOST_STATUS_CACHE_TTL_SECONDS,
            hostId,
          }
          // Raw client calls THROW on error (unlike fetchData); the
          // unknown-setting fallback inside runWithQueryCache handles both.
          const resultSet = await runWithQueryCache(cacheOpts, (cache) =>
            client.query({
              query: `${QUERY_COMMENT}SELECT
  version() AS version,
  formatReadableTimeDelta(uptime()) AS uptime,
  hostName() AS hostname`,
              format: 'JSONEachRow',
              clickhouse_settings: cache,
            })
          )

          // JSONEachRow returns rows directly: json<Row>() => Row[]
          const rows = await resultSet.json<{
            version: string
            uptime: string
            hostname: string
          }>()

          const data = rows[0]
          const version = data?.version ?? ''
          const uptime = data?.uptime ?? ''
          const hostname = data?.hostname ?? ''

          // Additive comparison counts for the Fleet table. Run in a separate,
          // fully guarded query so a counts failure never degrades the core
          // status response — missing counts simply resolve to undefined and
          // the table renders an en-dash for that cell.
          let counts: {
            databases?: number
            tables?: number
            clusterNodes?: number
          } = {}
          if (wantCounts) {
            try {
              const countsSet = await runWithQueryCache(cacheOpts, (cache) =>
                client.query({
                  query: `${QUERY_COMMENT}SELECT
  (SELECT count() FROM system.databases) AS databases,
  (SELECT count() FROM system.tables) AS tables,
  (SELECT uniqExact(host_name) FROM system.clusters) AS clusterNodes`,
                  format: 'JSONEachRow',
                  clickhouse_settings: cache,
                })
              )
              const countRows = await countsSet.json<{
                databases: string | number
                tables: string | number
                clusterNodes: string | number
              }>()
              const row = countRows[0]
              const toNum = (v: string | number | undefined) => {
                const n = Number(v)
                return Number.isFinite(n) ? n : undefined
              }
              counts = {
                databases: toNum(row?.databases),
                tables: toNum(row?.tables),
                clusterNodes: toNum(row?.clusterNodes),
              }
            } catch (countsErr) {
              error('[GET /api/v1/host-status] counts query failed:', countsErr)
            }
          }

          return Response.json({
            success: true,
            data: { version, uptime, hostname, ...counts },
          })
        } catch (err) {
          error('[GET /api/v1/host-status] Error:', err)
          // An unreachable upstream is a 503/504, not a 500.
          const { type, message } = classifyError(err)
          return Response.json(
            {
              success: false,
              error: message || 'Failed to fetch host status',
            },
            { status: getStatusCodeForErrorType(type) }
          )
        }
      },
    },
  },
})
