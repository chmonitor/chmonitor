/**
 * Batched health-checks endpoint
 * GET /api/v1/health/checks?hostId=0&charts=health-readonly-replicas,health-...&timezone=...
 *
 * The /health page renders ~12 health cards, each backed by a chart query in
 * the registry. Fetching them one-by-one means 12 parallel HTTP requests and a
 * per-card "Loading…" flash. This endpoint runs all requested checks
 * server-side in one round-trip and returns them keyed by chart name.
 *
 * It reuses the SAME chart query configs the individual cards use (resolved via
 * chart-registry + query-executor) — no SQL is duplicated here. Each check is
 * executed independently: if one fails server-side, its entry carries the error
 * while the others still resolve, so the matching card shows its own error
 * state and the rest render normally.
 *
 * The `charts` list is supplied by the client (derived from the health card
 * definitions). Every name is validated against the registry and gated by the
 * chart's own feature permission, so this exposes nothing the existing
 * /api/v1/charts/$name endpoint does not already.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { DataStatus } from '@/lib/api/types'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import {
  cachePolicyToQueryCacheTtlSeconds,
  getChartQuery,
  hasChart,
} from '@/lib/api/chart-registry'
import { executeChartQuery } from '@/lib/api/query-executor'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

/** Per-check result returned in the batched response. */
interface HealthCheckEntry {
  data: unknown[]
  status?: DataStatus
  statusMessage?: string
  clickhouseVersion?: string
  error?: { type: string; message: string }
}

/** Cap the number of checks a single request may ask for (defensive bound). */
const MAX_CHECKS = 40

export const Route = createFileRoute('/api/v1/health/checks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        const { searchParams } = new URL(request.url)

        // Validate hostId
        const hostId = Number(searchParams.get('hostId') ?? '0')
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              error: { type: 'validation', message: 'Invalid hostId' },
            },
            { status: 400 }
          )
        }

        // Validate timezone (ignore if invalid)
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

        // Requested check chart names (comma-separated, deduped).
        const charts = Array.from(
          new Set(
            (searchParams.get('charts') ?? '')
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean)
          )
        ).slice(0, MAX_CHECKS)

        if (charts.length === 0) {
          return Response.json(
            {
              success: false,
              error: { type: 'validation', message: 'No charts requested' },
            },
            { status: 400 }
          )
        }

        const entries = await Promise.all(
          charts.map(async (name): Promise<[string, HealthCheckEntry]> => {
            if (!hasChart(name)) {
              return [
                name,
                {
                  data: [],
                  error: {
                    type: 'table_not_found',
                    message: 'Chart not found',
                  },
                },
              ]
            }

            const queryDef = getChartQuery(name)
            if (!queryDef || 'queries' in queryDef) {
              // Health checks are all single-query charts; fail loud if a
              // multi-query chart is requested rather than silently dropping it.
              return [
                name,
                {
                  data: [],
                  error: {
                    type: 'query_error',
                    message: 'Unsupported health check query',
                  },
                },
              ]
            }

            // Enforce the chart's deployment feature gate, same as the
            // single-chart route. A blocked check carries an error instead of
            // failing the whole batch.
            const permissionResponse = await authorizeFeatureRequest(
              queryDef.permission,
              request
            )
            if (permissionResponse) {
              return [
                name,
                {
                  data: [],
                  error: {
                    type: 'permission_error',
                    message: `Feature requires authentication (status ${permissionResponse.status})`,
                  },
                },
              ]
            }

            try {
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
                  ttlSeconds: cachePolicyToQueryCacheTtlSeconds(
                    queryDef.cachePolicy
                  ),
                  disableQueryCache: queryDef.disableQueryCache,
                }
              )

              if (result.error) {
                // Missing optional tables surface as a friendly "unavailable"
                // status (matches the card's isUnavailable path) rather than a
                // hard error.
                if (result.error.type === 'table_not_found') {
                  return [
                    name,
                    {
                      data: [],
                      status: 'table_not_found',
                      statusMessage: result.error.message,
                      clickhouseVersion: result.clickhouseVersion,
                    },
                  ]
                }
                return [
                  name,
                  {
                    data: [],
                    clickhouseVersion: result.clickhouseVersion,
                    error: {
                      type: result.error.type ?? 'query_error',
                      message: result.error.message,
                    },
                  },
                ]
              }

              const parsed: unknown = result.dataJson
                ? JSON.parse(result.dataJson)
                : []
              return [
                name,
                {
                  data: Array.isArray(parsed) ? parsed : [],
                  clickhouseVersion: result.clickhouseVersion,
                },
              ]
            } catch (err) {
              error(`[GET /api/v1/health/checks:${name}]`, err)
              return [
                name,
                {
                  data: [],
                  error: {
                    type: 'query_error',
                    message:
                      err instanceof Error ? err.message : 'Unknown error',
                  },
                },
              ]
            }
          })
        )

        const checks: Record<string, HealthCheckEntry> = {}
        for (const [name, entry] of entries) checks[name] = entry

        return new Response(
          JSON.stringify({ success: true, host: String(hostId), checks }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
            },
          }
        )
      },
    },
  },
})
