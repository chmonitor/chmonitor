/**
 * Postgres AI Insights endpoint — GET/POST /api/v1/insights/postgres
 *
 * The Postgres analog of `/api/v1/insights` (GET read) and
 * `/api/v1/insights/generate` (POST generate), collapsed onto ONE route because
 * Postgres has a single, env-based source id space (`pgHostId`, index into the
 * `POSTGRES_*` lists) with no demo-host / cloud nuances.
 *
 * Fail-closed behind `CHM_FEATURE_POSTGRES_SOURCE`: when the flag is off the
 * route returns an empty, `disabled`-flagged payload (never an error) so a UI
 * probe degrades to "nothing to show". POST additionally self-enforces the
 * write gate (the collect → LLM enrich → persist pipeline is expensive), exactly
 * like the ClickHouse generate route.
 *
 * Query parameters:
 * - pg (required): Postgres source id (index into POSTGRES_* env lists)
 * - GET:  since (optional, default 6 HOUR), limit (optional, default 200)
 * - POST: enrich ("false" skips LLM), model, promptStyle, force ("true" bypasses
 *   the regeneration throttle — the manual Refresh)
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, generateRequestId } from '@chm/logger'
import { bridgeClickHouseEnv, bridgePostgresEnv } from '@/lib/api/server-env'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { generatePostgresInsights } from '@/lib/insights/generate-postgres-insights'
import { isInsightPromptStyle } from '@/lib/insights/prompts'
import { readPostgresInsights } from '@/lib/insights/read-postgres-insights'
import { resolveInsightModel } from '@/lib/insights/resolve-model'

/** Whether the Postgres source engine is enabled (server-side canonical flag). */
function postgresEnabled(
  bindings: Record<string, string | undefined>
): boolean {
  const raw =
    bindings.CHM_FEATURE_POSTGRES_SOURCE ??
    process.env.CHM_FEATURE_POSTGRES_SOURCE
  return raw === 'true'
}

/** Parse + validate the required `pg` source id. */
function parsePgHostId(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('pg')
  if (raw === null || raw.trim() === '') return null
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id >= 0 ? id : null
}

function bridgeEnv(): Record<string, string | undefined> {
  const bindings = env as Record<string, string | undefined>
  // The insights STORE may be ClickHouse (default backend), so bridge both.
  bridgeClickHouseEnv(bindings)
  bridgePostgresEnv(bindings)
  return bindings
}

async function handleGet(request: Request): Promise<Response> {
  const bindings = bridgeEnv()
  const requestId = generateRequestId()
  const headers = { 'X-Request-ID': requestId }

  if (!postgresEnabled(bindings)) {
    return Response.json(
      { insights: [], count: 0, disabled: true },
      { headers }
    )
  }

  const pgHostId = parsePgHostId(request)
  if (pgHostId === null) {
    return Response.json(
      { error: 'Invalid pg parameter: must be a non-negative integer' },
      { status: 400, headers }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const since = searchParams.get('since') ?? undefined
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    const insights = await readPostgresInsights(pgHostId, { since, limit })
    return Response.json({ insights, count: insights.length }, { headers })
  } catch (err) {
    error('[GET /api/v1/insights/postgres] Unexpected error:', err, {
      requestId,
    })
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers }
    )
  }
}

async function handlePost(request: Request): Promise<Response> {
  const bindings = bridgeEnv()
  const requestId = generateRequestId()
  const headers = { 'X-Request-ID': requestId }

  if (!postgresEnabled(bindings)) {
    return Response.json(
      { insights: [], count: 0, disabled: true },
      { headers }
    )
  }

  // Write gate: the global /api/v1 middleware is a public passthrough under
  // provider='none' / CHM_CLERK_PUBLIC_READ, so this expensive pipeline must
  // self-enforce that anonymous callers cannot trigger it. Mirrors the
  // ClickHouse generate route.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const pgHostId = parsePgHostId(request)
  if (pgHostId === null) {
    return Response.json(
      { error: 'Invalid pg parameter: must be a non-negative integer' },
      { status: 400, headers }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const enrich = searchParams.get('enrich') !== 'false'
    const model = resolveInsightModel(searchParams.get('model'))
    const styleParam = searchParams.get('promptStyle')
    const promptStyle = isInsightPromptStyle(styleParam)
      ? styleParam
      : undefined
    const force = searchParams.get('force') === 'true'

    const insights = await generatePostgresInsights(pgHostId, {
      enrich,
      model,
      promptStyle,
      force,
    })
    return Response.json({ insights, count: insights.length }, { headers })
  } catch (err) {
    error('[POST /api/v1/insights/postgres] Unexpected error:', err, {
      requestId,
    })
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers }
    )
  }
}

export const Route = createFileRoute('/api/v1/insights/postgres')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
})
