/**
 * AI Insights generation endpoint — POST /api/v1/insights/generate
 *
 * Runs the insight pipeline (collect → optional LLM enrich → persist) for a
 * host and returns the freshly generated insights. Backs the manual "Refresh"
 * button on the overview panel; the cron sweep generates the same insights
 * autonomously every few minutes.
 *
 * Best-effort: degrades silently on read-only clusters or when no LLM key is
 * configured (deterministic insights are still produced and returned).
 *
 * Query parameters:
 * - host (optional, default 0): host to generate insights for
 * - enrich (optional): "false" skips LLM enrichment (deterministic copy only)
 * - model (optional): `provider:model` id for enrichment; validated server-side,
 *   ignored when unknown/unconfigured (falls back to the deployment default)
 * - promptStyle (optional): "concise" | "detailed" | "beginner" (default concise)
 * - force (optional): "true" bypasses the server-side min-interval regeneration
 *   throttle (the explicit manual "Refresh"); otherwise a fresh set within the
 *   throttle window returns the stored insights without re-running the scans
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, generateRequestId } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { generateInsights } from '@/lib/insights/generate-insights'
import { isInsightPromptStyle } from '@/lib/insights/prompts'
import { resolveInsightModel } from '@/lib/insights/resolve-model'

async function handlePost(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)
  const requestId = generateRequestId()

  // Write gate: this POST runs the expensive collect → LLM enrich → persist
  // pipeline. The global /api/v1 middleware is a public passthrough under
  // provider='none' / CHM_CLERK_PUBLIC_READ, so this route must self-enforce
  // that anonymous callers cannot trigger it. A valid `chm_` API key still
  // authenticates programmatic clients. Mirrors the /api/v1/actions guard.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  try {
    const searchParams = new URL(request.url).searchParams
    const hostId = Number.parseInt(searchParams.get('host') ?? '0', 10)
    if (!Number.isInteger(hostId) || hostId < 0) {
      return Response.json(
        { error: 'Invalid host parameter: must be a non-negative integer' },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      )
    }

    // Optional generation overrides. All are best-effort: an unknown model or
    // style is dropped server-side so a stale request never breaks generation.
    const enrich = searchParams.get('enrich') !== 'false'
    const model = resolveInsightModel(searchParams.get('model'))
    const styleParam = searchParams.get('promptStyle')
    const promptStyle = isInsightPromptStyle(styleParam)
      ? styleParam
      : undefined
    // Explicit manual "Refresh" passes force=true to bypass the server-side
    // min-interval throttle in generateInsights; auto/cron triggers omit it.
    const force = searchParams.get('force') === 'true'

    const insights = await generateInsights(hostId, {
      enrich,
      model,
      promptStyle,
      force,
    })

    return Response.json(
      { insights, count: insights.length },
      { headers: { 'X-Request-ID': requestId } }
    )
  } catch (err) {
    error('[POST /api/v1/insights/generate] Unexpected error:', err, {
      requestId,
    })
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    )
  }
}

export const Route = createFileRoute('/api/v1/insights/generate')({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
    },
  },
})
