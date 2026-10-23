/**
 * POST /api/v1/charts/batch
 *
 * Runs a known chart grouping (not an arbitrary name list) through
 * `executeChartGrouping`. Rate-limited like GET /api/v1/charts/$name.
 * Cache-Control uses the minimum s-maxage of grouping members.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { runWithAttribution } from '@chm/clickhouse-client/attribution'
import { error } from '@chm/logger'
import {
  executeChartGrouping,
  getChartGrouping,
  groupingCacheControl,
  isKnownChartGrouping,
  UnknownChartGroupingError,
} from '@/lib/api/chart-batch'
import { validateChartParams } from '@/lib/api/chart-param-validator'
import { getChartQuery } from '@/lib/api/chart-registry'
import {
  classifyError,
  getStatusCodeForErrorType,
} from '@/lib/api/error-handler'
import { isValidInterval } from '@/lib/api/query-executor'
import {
  checkRateLimitDurable,
  clientIpKey,
  getApiRateLimitPerMin,
  RATE_LIMIT_BINDING_API,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const MAX_LAST_HOURS = 24 * 365

/**
 * Rows as a JSON array string, spliced into the body without a parse and
 * re-stringify. `dataJson` is the executor's own `JSON.stringify(rows)`, so
 * it is already valid JSON. Shape rules match the old parse-based path:
 * array as-is, single object wrapped, null / empty / scalar become `[]`.
 */
function rowsJson(dataJson: string | null): string {
  if (!dataJson) return '[]'
  const text = dataJson.trim()
  if (text.startsWith('[')) return text
  if (text.startsWith('{')) return `[${text}]`
  return '[]'
}

export async function handler(request: Request): Promise<Response> {
  const ip = clientIpKey(request)
  const rlResult = await checkRateLimitDurable(
    `charts:ip:${ip}`,
    getApiRateLimitPerMin(),
    RATE_LIMIT_BINDING_API
  )
  if (!rlResult.allowed) return rateLimitResponse(rlResult.retryAfterSec)

  const bindings = env as Record<string, string | undefined>

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      {
        success: false,
        error: { type: 'validation', message: 'Invalid JSON body' },
      },
      { status: 400 }
    )
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json(
      {
        success: false,
        error: { type: 'validation', message: 'Body must be an object' },
      },
      { status: 400 }
    )
  }

  const record = body as Record<string, unknown>
  const groupingIdRaw = record.groupingId ?? record.grouping
  const hostIdRaw = record.hostId
  const lastHoursRaw = record.lastHours
  const intervalRaw = record.interval
  const rawParams = record.params
  const timezoneParam = record.timezone

  if (
    typeof groupingIdRaw !== 'string' ||
    !isKnownChartGrouping(groupingIdRaw)
  ) {
    return Response.json(
      {
        success: false,
        error: {
          type: 'validation',
          message: `Unknown chart grouping: ${String(groupingIdRaw)}`,
        },
      },
      { status: 400 }
    )
  }
  const groupingId = groupingIdRaw

  const hostId = parseHostIdParam(hostIdRaw)
  if (typeof hostId !== 'number' || !Number.isInteger(hostId) || hostId < 0) {
    return Response.json(
      {
        success: false,
        error: { type: 'validation', message: 'Invalid hostId' },
      },
      { status: 400 }
    )
  }

  if (await isDemoHostBlockedForRequest(hostId, bindings)) {
    const names = getChartGrouping(groupingId) ?? []
    const empty: Record<string, { data: unknown[]; metadata: object }> = {}
    for (const name of names) {
      empty[name] = {
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
      }
    }
    return Response.json({ success: true, data: empty })
  }

  const lastHoursParsed =
    lastHoursRaw === undefined || lastHoursRaw === null
      ? undefined
      : Number(lastHoursRaw)
  const lastHours =
    lastHoursParsed !== undefined &&
    Number.isFinite(lastHoursParsed) &&
    lastHoursParsed > 0
      ? Math.min(lastHoursParsed, MAX_LAST_HOURS)
      : undefined

  const interval =
    typeof intervalRaw === 'string' && isValidInterval(intervalRaw)
      ? intervalRaw
      : undefined

  let chartParams: Record<string, unknown> | undefined
  if (rawParams !== undefined && rawParams !== null) {
    if (typeof rawParams !== 'object' || Array.isArray(rawParams)) {
      return Response.json(
        {
          success: false,
          error: { type: 'validation', message: 'Invalid params' },
        },
        { status: 400 }
      )
    }
    const validation = validateChartParams(rawParams as Record<string, unknown>)
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

  let timezone: string | undefined
  if (typeof timezoneParam === 'string' && timezoneParam.length > 0) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezoneParam }).format(
        new Date()
      )
      timezone = timezoneParam
    } catch {
      // Invalid timezone, ignore
    }
  }

  const names = getChartGrouping(groupingId) ?? []
  // Authorize each distinct permission once, in first-seen order so the first
  // denial is the same one the per-chart loop returned.
  const authorized = new Set<string>()
  for (const name of names) {
    const queryDef = getChartQuery(name, {
      lastHours,
      interval,
      params: chartParams,
      timezone,
    })
    if (!queryDef) continue
    if (queryDef.permission) {
      const key = JSON.stringify(queryDef.permission)
      if (authorized.has(key)) continue
      authorized.add(key)
    }
    const permissionResponse = await authorizeFeatureRequest(
      queryDef.permission,
      request
    )
    if (permissionResponse) return permissionResponse
  }

  try {
    const grouped = await runWithAttribution(
      { source: `chart-group:${groupingId}` },
      () =>
        executeChartGrouping(groupingId, hostId, {
          bindings,
          lastHours,
          interval,
          params: chartParams,
          timezone,
        })
    )

    const entries: string[] = []
    for (const [name, entry] of Object.entries(grouped)) {
      const metadata = {
        queryId: String(entry.metadata?.queryId || ''),
        duration: Number(entry.metadata?.duration || 0),
        rows: Number(entry.metadata?.rows || 0),
        host: String(hostId),
        sql: entry.executedSql?.trim(),
      }
      const errorJson = entry.error
        ? `,"error":${JSON.stringify({
            type: entry.error.type,
            message: entry.error.message,
          })}`
        : ''
      entries.push(
        `${JSON.stringify(name)}:{"data":${rowsJson(entry.dataJson)},"metadata":${JSON.stringify(metadata)}${errorJson}}`
      )
    }

    return new Response(`{"success":true,"data":{${entries.join(',')}}}`, {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Cache-Control': groupingCacheControl(names),
      },
    })
  } catch (err) {
    if (err instanceof UnknownChartGroupingError) {
      return Response.json(
        {
          success: false,
          error: { type: 'validation', message: err.message },
        },
        { status: 400 }
      )
    }
    error('[POST /api/v1/charts/batch] Unhandled exception:', err)
    const { type, message } = classifyError(err)
    return Response.json(
      { success: false, error: { type, message } },
      { status: getStatusCodeForErrorType(type) }
    )
  }
}

export const Route = createFileRoute('/api/v1/charts/batch')({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
})
