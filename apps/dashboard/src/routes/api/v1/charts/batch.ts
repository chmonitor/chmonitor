/**
 * POST /api/v1/charts/batch
 *
 * Runs a known chart grouping (not an arbitrary name list) through
 * `executeChartGrouping`. Rate-limited like GET /api/v1/charts/$name.
 * Cache-Control uses the minimum s-maxage of grouping members.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
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
import {
  checkRateLimitDurable,
  clientIpKey,
  getApiRateLimitPerMin,
  RATE_LIMIT_BINDING_API,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const MAX_LAST_HOURS = 24 * 365

function parseDataJson(dataJson: string | null): unknown[] {
  if (!dataJson || dataJson === 'null') return []
  try {
    const parsed = JSON.parse(dataJson) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch {
    return []
  }
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

  const hostId =
    typeof hostIdRaw === 'string' ? Number.parseInt(hostIdRaw, 10) : hostIdRaw
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
  for (const name of names) {
    const queryDef = getChartQuery(name, {
      lastHours,
      params: chartParams,
      timezone,
    })
    if (!queryDef) continue
    const permissionResponse = await authorizeFeatureRequest(
      queryDef.permission,
      request
    )
    if (permissionResponse) return permissionResponse
  }

  try {
    const grouped = await executeChartGrouping(groupingId, hostId, {
      bindings,
      lastHours,
      params: chartParams,
      timezone,
    })

    const data: Record<
      string,
      {
        data: unknown[]
        metadata: Record<string, unknown>
        error?: { type: string; message: string }
      }
    > = {}

    for (const [name, entry] of Object.entries(grouped)) {
      data[name] = {
        data: parseDataJson(entry.dataJson),
        metadata: {
          queryId: String(entry.metadata?.queryId || ''),
          duration: Number(entry.metadata?.duration || 0),
          rows: Number(entry.metadata?.rows || 0),
          host: String(hostId),
          sql: entry.executedSql?.trim(),
        },
        ...(entry.error
          ? {
              error: {
                type: entry.error.type,
                message: entry.error.message,
              },
            }
          : {}),
      }
    }

    return Response.json(
      { success: true, data },
      {
        headers: {
          'Cache-Control': groupingCacheControl(names),
        },
      }
    )
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
