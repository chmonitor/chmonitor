/**
 * PeerDB AI Insights endpoint — GET/POST /api/v1/insights/peerdb
 *
 * The PeerDB analog of `/api/v1/insights/postgres` (GET read + POST generate
 * collapsed onto ONE route). PeerDB is a single deployment (one flow-api), so
 * there is no source-id parameter — unlike Postgres' `?pg=` — and per-connection
 * (`?connection=<id>`) sweep/generation is out of v1: both verbs cover the
 * env-wide deployment only.
 *
 * Fail-graceful behind the PeerDB gate: when `PEERDB_API_URL` is unset (or the
 * flow-api is unreachable) the route returns an empty, `unavailable`-flagged
 * payload (never an error) so a UI probe degrades to "nothing to show". POST
 * additionally self-enforces the write gate (the collect → LLM enrich →
 * persist pipeline is expensive), exactly like the Postgres generate path.
 *
 * Query parameters:
 * - GET:  since (optional, default 6 HOUR), limit (optional, default 200)
 * - POST: enrich ("false" skips LLM), model, promptStyle, force ("true" bypasses
 *   the regeneration throttle — the manual Refresh)
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, generateRequestId } from '@chm/logger'
import { bridgeClickHouseEnv, bridgePeerDBEnv } from '@/lib/api/server-env'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { generatePeerDBInsights } from '@/lib/insights/generate-peerdb-insights'
import { isInsightPromptStyle } from '@/lib/insights/prompts'
import { readPeerDBInsights } from '@/lib/insights/read-peerdb-insights'
import { resolveInsightModel } from '@/lib/insights/resolve-model'
import { envPeerDBConfig } from '@/lib/peerdb/peerdb-auth'

function bridgeEnv(): Record<string, string | undefined> {
  const bindings = env as Record<string, string | undefined>
  // The insights STORE may be ClickHouse (default backend), so bridge both —
  // plus PEERDB_* so the collectors' env gate sees the deployment config.
  bridgeClickHouseEnv(bindings)
  bridgePeerDBEnv(bindings)
  return bindings
}

/** PeerDB gate: the env-wide flow-api config (per-connection is out of v1). */
function peerdbConfigured(
  bindings: Record<string, string | undefined>
): boolean {
  try {
    if (envPeerDBConfig(bindings) !== null) return true
  } catch {
    // fall through to the process.env check below
  }
  return Boolean(process.env.PEERDB_API_URL?.trim())
}

function unavailableBody() {
  return {
    insights: [],
    count: 0,
    unavailable: {
      reason: 'peerdb_not_configured',
      message: 'PeerDB is not configured on this deployment.',
    },
  }
}

async function handleGet(request: Request): Promise<Response> {
  const bindings = bridgeEnv()
  const requestId = generateRequestId()
  const headers = { 'X-Request-ID': requestId }

  if (!peerdbConfigured(bindings)) {
    return Response.json(unavailableBody(), { headers })
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const since = searchParams.get('since') ?? undefined
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    const insights = await readPeerDBInsights({ since, limit })
    return Response.json({ insights, count: insights.length }, { headers })
  } catch (err) {
    error('[GET /api/v1/insights/peerdb] Unexpected error:', err, {
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

  if (!peerdbConfigured(bindings)) {
    return Response.json(unavailableBody(), { headers })
  }

  // Write gate: the global /api/v1 middleware is a public passthrough under
  // provider='none' / CHM_CLERK_PUBLIC_READ, so this expensive pipeline must
  // self-enforce that anonymous callers cannot trigger it. Mirrors the
  // Postgres generate route.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  try {
    const searchParams = new URL(request.url).searchParams
    const enrich = searchParams.get('enrich') !== 'false'
    const model = resolveInsightModel(searchParams.get('model'))
    const styleParam = searchParams.get('promptStyle')
    const promptStyle = isInsightPromptStyle(styleParam)
      ? styleParam
      : undefined
    const force = searchParams.get('force') === 'true'

    const insights = await generatePeerDBInsights({
      enrich,
      model,
      promptStyle,
      force,
    })
    return Response.json({ insights, count: insights.length }, { headers })
  } catch (err) {
    error('[POST /api/v1/insights/peerdb] Unexpected error:', err, {
      requestId,
    })
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers }
    )
  }
}

export const Route = createFileRoute('/api/v1/insights/peerdb')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
})
