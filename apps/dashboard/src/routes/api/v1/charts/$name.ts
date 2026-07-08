/**
 * Chart-specific data endpoint
 * GET /api/v1/charts/$name?hostId=0&interval=toStartOfTenMinutes&lastHours=24
 *
 * Thin wrapper using query-executor + chart-registry. The executor handles
 * CH version selection, table availability, and query execution.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { validateChartParams } from '@/lib/api/chart-param-validator'
import {
  cachePolicyToQueryCacheTtlSeconds,
  getAvailableCharts,
  getChartQuery,
  hasChart,
} from '@/lib/api/chart-registry'
import {
  classifyError,
  getStatusCodeForErrorType,
} from '@/lib/api/error-handler'
import {
  executeChartQuery,
  executeMultiChartQuery,
  isValidInterval,
} from '@/lib/api/query-executor'
import {
  checkRateLimit,
  clientIpKey,
  getApiRateLimitPerMin,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import {
  buildEdgeCacheKey,
  isEdgeCacheEligible,
  matchEdgeCache,
  putEdgeCache,
} from '@/lib/api/shared/edge-cache'
import { statusForFetchDataError } from '@/lib/api/shared/fetch-data-error'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

/**
 * GET handler for `/api/v1/charts/$name`, extracted as a named export so it can
 * be unit-tested without the router. {@link Route} below delegates to it.
 */
export async function handler(
  request: Request,
  name: string
): Promise<Response> {
  // Rate-limit by client IP before doing any work
  const ip = clientIpKey(request)
  const rlResult = checkRateLimit(`charts:ip:${ip}`, getApiRateLimitPerMin())
  if (!rlResult.allowed) return rateLimitResponse(rlResult.retryAfterSec)

  const bindings = env as Record<string, string | undefined>
  const { searchParams } = new URL(request.url)

  // Validate hostId
  const hostIdStr = searchParams.get('hostId') ?? '0'
  const hostId = Number(hostIdStr)
  if (!Number.isInteger(hostId) || hostId < 0) {
    return Response.json(
      {
        success: false,
        error: { type: 'validation', message: 'Invalid hostId' },
      },
      { status: 400 }
    )
  }

  // Cloud demo-hiding invariant (#2172): user connections always use negative
  // hostIds, so a non-negative id from a signed-in cloud principal can only be
  // the hidden env/demo host. Reject with the same structured-empty shape used
  // for an optional chart's missing table, rather than a 403/leak. No-op for
  // OSS and anonymous cloud callers (both legitimately use hostId=0).
  if (await isDemoHostBlockedForRequest(hostId, bindings)) {
    return Response.json({
      success: true,
      data: [],
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: String(hostId),
        unavailable: {
          reason: 'demo_hidden',
          message: 'The demo host is hidden for signed-in accounts.',
        },
      },
    })
  }

  // Check if chart exists
  if (!hasChart(name)) {
    return Response.json(
      {
        success: false,
        error: {
          type: 'table_not_found',
          message: `Chart not found: ${name}`,
          details: { availableCharts: getAvailableCharts().join(', ') },
        },
      },
      { status: 404 }
    )
  }

  // Parse query parameters
  const intervalParam = searchParams.get('interval')
  const interval =
    intervalParam && isValidInterval(intervalParam) ? intervalParam : undefined

  // Cap the requested window so a hand-crafted `lastHours` cannot force an
  // unbounded scan of `system.query_log` / `part_log`. The maximum mirrors the
  // widest built-in chart window (the activity heatmap: one year), which is the
  // largest range any UI control can request.
  const MAX_LAST_HOURS = 24 * 365
  const lastHoursParam = searchParams.get('lastHours')
  const lastHoursParsed = lastHoursParam ? Number(lastHoursParam) : undefined
  const lastHours =
    lastHoursParsed !== undefined &&
    Number.isFinite(lastHoursParsed) &&
    lastHoursParsed > 0
      ? Math.min(lastHoursParsed, MAX_LAST_HOURS)
      : undefined

  const paramStr = searchParams.get('params')
  let chartParams: Record<string, unknown> | undefined
  if (paramStr) {
    let parsed: unknown
    try {
      parsed = JSON.parse(paramStr)
    } catch {
      return Response.json(
        {
          success: false,
          error: { type: 'validation', message: 'Invalid JSON in params' },
        },
        { status: 400 }
      )
    }
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      // Validate/sanitize before forwarding to the chart executor
      const validation = validateChartParams(parsed as Record<string, unknown>)
      if (validation.type === 'validation') {
        return Response.json(
          {
            success: false,
            error: {
              type: 'validation',
              message: validation.message,
              field: validation.field,
            },
          },
          { status: 400 }
        )
      }
      chartParams = validation.params
    }
  }

  // Validate timezone
  const timezoneParam = searchParams.get('timezone') || undefined
  let timezone: string | undefined
  if (timezoneParam) {
    try {
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezoneParam,
      }).format(new Date())
      timezone = timezoneParam
    } catch {
      // Invalid timezone, ignore
    }
  }

  // Get chart query definition
  const queryDef = getChartQuery(name, {
    interval,
    lastHours,
    params: chartParams,
  })

  if (!queryDef) {
    error(`[GET /api/v1/charts/${name}] Failed to build query`)
    return Response.json(
      {
        success: false,
        error: {
          type: 'query_error',
          message: `Failed to build query for chart: ${name}`,
        },
      },
      { status: 500 }
    )
  }

  // Enforce the chart's deployment-level feature gate (e.g. system
  // metric charts carry METRICS_PERMISSION). Without this, direct
  // requests like /api/v1/charts/memory-usage would bypass
  // CHM_DISABLED_FEATURES / CHM_AUTH_REQUIRED_FEATURES. Matches the
  // dashboard chart route.
  const permissionResponse = await authorizeFeatureRequest(
    queryDef.permission,
    request
  )
  if (permissionResponse) return permissionResponse

  // Shared edge cache (#2181): only ever consulted for an anonymous request
  // on a deployment that has opted into public read access — see
  // `isEdgeCacheEligible`'s doc comment for why this gate must never be
  // relaxed. `edgeCacheKey` stays `undefined` (cache skipped entirely) for
  // every other request, including any authenticated/per-user caller.
  const edgeCacheEligible = await isEdgeCacheEligible(request)
  const edgeCacheKey = edgeCacheEligible
    ? buildEdgeCacheKey('charts', {
        name,
        hostId,
        interval,
        lastHours,
        params: chartParams ? JSON.stringify(chartParams) : undefined,
        timezone,
      })
    : undefined
  if (edgeCacheKey) {
    const cached = await matchEdgeCache(edgeCacheKey)
    if (cached) return cached
  }

  try {
    // Multi-query chart (summary charts)
    if ('queries' in queryDef) {
      const { results } = await executeMultiChartQuery(
        queryDef.queries.map((q) => ({ key: q.key, query: q.query })),
        hostId,
        {
          bindings,
          timezone,
          ttlSeconds: cachePolicyToQueryCacheTtlSeconds(queryDef.cachePolicy),
          disableQueryCache: queryDef.disableQueryCache,
        }
      )

      const combinedEntries: string[] = []
      let firstError: { type: string; message: string } | undefined
      for (const r of results) {
        combinedEntries.push(`${JSON.stringify(r.key)}:${r.dataJson ?? 'null'}`)
        if (r.error && !firstError) {
          firstError = { type: r.error.type, message: r.error.message }
        }
      }

      const metadata = {
        queryId: '',
        duration: 0,
        rows: 0,
        host: String(hostId),
        sql: queryDef.queries
          .map((q, i) => `-- Query ${i + 1}: ${q.key}\n${q.query.trim()}`)
          .join('\n\n'),
        timezone,
      }

      const errorJson = firstError
        ? `,"error":${JSON.stringify(firstError)}`
        : ''
      const body = `{"success":${String(!firstError)},"data":{${combinedEntries.join(',')}},"metadata":${JSON.stringify(metadata)}${errorJson}}`

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Single-query chart
    const result = await executeChartQuery(
      name,
      queryDef.sql ?? queryDef.query,
      hostId,
      queryDef.queryParams,
      {
        bindings,
        timezone,
        optional: queryDef.optional,
        tableCheck: queryDef.tableCheck,
        ttlSeconds: cachePolicyToQueryCacheTtlSeconds(queryDef.cachePolicy),
        disableQueryCache: queryDef.disableQueryCache,
      }
    )

    // Graceful degradation: an *optional* chart whose backing table is absent
    // is not a server error — the data layer signals this with a benign
    // `table_not_found`. Returning 200 with empty data (plus an `unavailable`
    // note) lets the panel render its "not available" empty state instead of a
    // red error, and stops use-chart-data from retrying the 500 three times.
    if (
      result.error &&
      queryDef.optional &&
      result.error.type === 'table_not_found'
    ) {
      const missingTables = Array.isArray(result.error.details?.missingTables)
        ? result.error.details.missingTables
        : []
      const body = JSON.stringify({
        success: true,
        data: [],
        metadata: {
          queryId: '',
          duration: 0,
          rows: 0,
          host: String(hostId),
          sql: result.executedSql.trim(),
          unavailable: {
            reason: 'table_not_found',
            message: result.error.message,
            missingTables,
          },
        },
      })
      const unavailableResponse = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      })
      if (edgeCacheKey) {
        await putEdgeCache(edgeCacheKey, unavailableResponse)
      }
      return unavailableResponse
    }

    if (result.error) {
      // Preserve the client's classification (e.g. an unreachable upstream is
      // ssl_error/network_error → 503) instead of flattening every failure to a
      // 500. See statusForFetchDataError for the rationale.
      // Always include metadata.sql so empty/error cards can still open the
      // "review query" toolbar even when the host rejects the query.
      return Response.json(
        {
          success: false,
          error: {
            type: result.error.type,
            message: result.error.message,
            details: result.error.details,
          },
          metadata: {
            queryId: '',
            duration: 0,
            rows: 0,
            host: String(hostId),
            sql: result.executedSql.trim(),
            clickhouseVersion: result.clickhouseVersion,
          },
        },
        { status: statusForFetchDataError(result.error.type) }
      )
    }

    // Build API URL for metadata
    const apiQueryParams = new URLSearchParams()
    apiQueryParams.set('hostId', String(hostId))
    if (interval) apiQueryParams.set('interval', interval)
    if (lastHours !== undefined)
      apiQueryParams.set('lastHours', String(lastHours))
    if (chartParams) apiQueryParams.set('params', JSON.stringify(chartParams))
    if (timezone) apiQueryParams.set('timezone', timezone)

    const responseMetadata = {
      queryId: String(result.metadata.queryId || ''),
      duration: Number(result.metadata.duration || 0),
      rows: Number(result.metadata.rows || 0),
      host: String(hostId),
      sql: result.executedSql.trim(),
      clickhouseVersion: result.clickhouseVersion,
      api: `/api/v1/charts/${name}?${apiQueryParams.toString()}`,
      timezone,
    }

    const body = `{"success":true,"data":${result.dataJson ?? '[]'},"metadata":${JSON.stringify(responseMetadata)}}`

    const cacheControl =
      queryDef.cachePolicy === 'realtime'
        ? 'public, s-maxage=10, stale-while-revalidate=30'
        : queryDef.cachePolicy === 'historical'
          ? 'public, s-maxage=120, stale-while-revalidate=300'
          : 'public, s-maxage=30, stale-while-revalidate=60'

    const successResponse = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
      },
    })
    if (edgeCacheKey) {
      await putEdgeCache(edgeCacheKey, successResponse)
    }
    return successResponse
  } catch (err) {
    error(`[GET /api/v1/charts/${name}] Unhandled exception:`, err)
    // Classify so an upstream connectivity exception surfaces as 503/504
    // rather than a misleading 500.
    const { type, message } = classifyError(err)
    return Response.json(
      {
        success: false,
        error: { type, message },
      },
      { status: getStatusCodeForErrorType(type) }
    )
  }
}

export const Route = createFileRoute('/api/v1/charts/$name')({
  server: {
    handlers: {
      GET: ({ request, params }) => handler(request, params.name),
    },
  },
})
