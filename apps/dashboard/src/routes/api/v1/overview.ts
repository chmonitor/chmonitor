/**
 * Overview Batch API Endpoint
 * GET /api/v1/overview?hostId=0
 *
 * Batch endpoint that returns all overview page metrics in a single request.
 * Ported from apps/dashboard/app/api/v1/overview/route.ts.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import {
  classifyError,
  getStatusCodeForErrorType,
} from '@/lib/api/error-handler'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { statusForFetchDataError } from '@/lib/api/shared/fetch-data-error'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

const ROUTE_CONTEXT = { route: '/api/v1/overview' }

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${units[i]}`
}

export const Route = createFileRoute('/api/v1/overview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const url = new URL(request.url)
        const hostIdRaw = url.searchParams.get('hostId')

        if (hostIdRaw === null || hostIdRaw === '') {
          return Response.json(
            { success: false, error: 'Missing required parameter: hostId' },
            { status: 400 }
          )
        }

        const hostId = Number.parseInt(hostIdRaw, 10)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              error: 'Invalid parameter: hostId must be a non-negative integer',
            },
            { status: 400 }
          )
        }

        // Cloud demo-hiding invariant (#2172): reject a non-negative hostId
        // for an authenticated cloud principal (the hidden env/demo host).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          return Response.json({
            success: true,
            data: null,
            metadata: {
              rows: 0,
              duration: 0,
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            },
          })
        }

        try {
          // The metrics batch query and the host-info query are independent —
          // kick both off concurrently and await together.
          const metricsPromise = fetchData({
            query: `
              -- Running queries count
              SELECT 'running_queries' as metric, COUNT() as value, COUNT() as value_num
              FROM system.processes
              WHERE is_cancelled = 0

              UNION ALL

              -- Today's query count
              SELECT 'today_queries' as metric, COUNT() as value, COUNT() as value_num
              FROM merge('system', '^query_log')
              WHERE type = 'QueryFinish' AND toDate(event_time) = today()

              UNION ALL

              -- Database count
              SELECT 'database_count' as metric, countDistinct(database) as value, countDistinct(database) as value_num
              FROM system.tables
              WHERE lower(database) NOT IN ('system', 'information_schema')

              UNION ALL

              -- Table count
              SELECT 'table_count' as metric, countDistinct(format('{}.{}', database, table)) as value, countDistinct(format('{}.{}', database, table)) as value_num
              FROM system.tables
              WHERE lower(database) NOT IN ('system', 'information_schema')

              UNION ALL

              -- Disk usage (used space in bytes)
              SELECT 'disk_used' as metric, toString((total_space - unreserved_space)) as value, (total_space - unreserved_space) as value_num
              FROM system.disks
              ORDER BY name
              LIMIT 1

              UNION ALL

              -- Disk total space
              SELECT 'disk_total' as metric, toString(total_space) as value, total_space as value_num
              FROM system.disks
              ORDER BY name
              LIMIT 1
            `,
            hostId,
            format: 'JSONEachRow',
          })

          // Fetch host info separately (different return shape)
          const hostPromise = fetchData({
            query: `
              SELECT
                version() as version,
                formatReadableTimeDelta(uptime()) as uptime,
                hostName() as hostname
            `,
            hostId,
            format: 'JSONEachRow',
          })

          const [result, hostResult] = await Promise.all([
            metricsPromise,
            hostPromise,
          ])

          if (result.error || !result.data) {
            error('[GET /api/v1/overview] Query error:', result.error)
            // A down upstream (ssl_error/network_error) is a 503, not a 500.
            const status = result.error
              ? statusForFetchDataError(result.error.type)
              : 500
            return Response.json(
              {
                success: false,
                error: result.error?.message || 'No data returned',
              },
              { status }
            )
          }

          const metrics = result.data as Array<{
            metric: string
            value: string
            value_num: number
          }>

          const overviewData: Record<string, number> = {}
          for (const row of metrics) {
            overviewData[row.metric] = row.value_num
          }

          const hostInfo = (
            hostResult.data as Array<{
              version: string
              uptime: string
              hostname: string
            }>
          )?.[0] || { version: '', uptime: '', hostname: '' }

          const diskUsed = overviewData.disk_used || 0
          const diskTotal = overviewData.disk_total || 1
          const diskPercent =
            diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0

          const response = {
            runningQueries: overviewData.running_queries || 0,
            todayQueries: overviewData.today_queries || 0,
            databaseCount: overviewData.database_count || 0,
            tableCount: overviewData.table_count || 0,
            diskUsage: {
              used: formatSize(diskUsed),
              total: formatSize(diskTotal),
              percent: diskPercent,
              usedBytes: diskUsed,
              totalBytes: diskTotal,
            },
            hostInfo: {
              version: hostInfo.version || '',
              uptime: hostInfo.uptime || '',
              hostname: hostInfo.hostname || '',
            },
          }

          return Response.json({
            success: true,
            data: response,
            metadata: {
              rows: Number(result.metadata.rows ?? 0),
              duration: Number(result.metadata.duration ?? 0),
            },
          })
        } catch (err) {
          error('[GET /api/v1/overview] Error:', err, ROUTE_CONTEXT)
          const { type, message } = classifyError(err)
          return Response.json(
            {
              success: false,
              error: message,
            },
            { status: getStatusCodeForErrorType(type) }
          )
        }
      },
    },
  },
})
