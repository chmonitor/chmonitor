import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  hostIdSchema,
  READONLY_ANNOTATIONS,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
} from './helpers'

export function registerMetricsTool(server: McpServer) {
  server.tool(
    'get_metrics',
    'Get key ClickHouse server metrics: version, uptime, active connections, and memory usage.',
    {
      hostId: hostIdSchema,
    },
    { ...READONLY_ANNOTATIONS, title: 'Get Server Metrics' },
    async ({ hostId }) => {
      const [versionResult, uptimeResult, metricsResult] = await Promise.all([
        runReadonlyFetch({ query: 'SELECT version() AS version', hostId }),
        runReadonlyFetch({
          query: 'SELECT uptime() AS uptime_seconds',
          hostId,
        }),
        runReadonlyFetch({
          query:
            "SELECT metric, value FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking') ORDER BY metric",
          hostId,
        }),
      ])

      const errors = [versionResult, uptimeResult, metricsResult]
        .filter((r) => r.error)
        .map((r) => r.error!.message)

      if (errors.length > 0) {
        return toErrorResult(`Errors: ${errors.join('; ')}`)
      }

      const versionRow = (
        Array.isArray(versionResult.data)
          ? versionResult.data[0]
          : versionResult.data
      ) as Record<string, unknown>
      const uptimeRow = (
        Array.isArray(uptimeResult.data)
          ? uptimeResult.data[0]
          : uptimeResult.data
      ) as Record<string, unknown>

      const combined = {
        version: versionRow?.version,
        uptime_seconds: uptimeRow?.uptime_seconds,
        metrics: metricsResult.data,
      }

      return toJsonResult(combined)
    }
  )
}
