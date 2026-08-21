/**
 * Auth gate for POST /api/v1/insights/generate.
 *
 * Insights generation runs the collect → LLM enrich → persist pipeline — a
 * write — so it is gated like the agent/actions writes. But unlike those, the
 * cloud demo is meant to show AI features to anonymous visitors: the public
 * read-only demo host (hostId 0) should be able to generate insights without
 * sign-in. So, mirroring `agent-api-auth.ts`, anonymous cloud visitors on the
 * generate path get a carve-out; everyone else is held to the normal write
 * gate (signed-in Clerk session, `chm_` API key, agent bearer token, or auth
 * `none`).
 *
 * The demo-hiding invariant still applies AFTER this gate (see
 * `isDemoHostBlockedForRequest` in the route): a signed-in cloud user hitting
 * the env/demo host gets `demo_hidden` — only anonymous cloud callers may
 * legitimately use host=0.
 */

import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { INSIGHTS_GENERATE_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import {
  authorizeFeatureRequest,
  isAnonymousPublicReadRequest,
} from '@/lib/feature-permissions/server'

/** The only insights route anonymous cloud visitors may trigger. */
const CLOUD_GUEST_INSIGHTS_PATH = '/api/v1/insights/generate'

/**
 * Cloud + public-read + unsigned → allow generating insights for the public
 * demo host. Does not grant `anonymousCapabilities.write`.
 */
export async function isCloudGuestInsightsRequest(
  request: Request
): Promise<boolean> {
  if (!isCloudModeServer()) return false
  if (new URL(request.url).pathname !== CLOUD_GUEST_INSIGHTS_PATH) return false
  return isAnonymousPublicReadRequest(request)
}

export async function authorizeInsightsGenerateRequest(
  request: Request
): Promise<Response | null> {
  const denied = await authorizeFeatureRequest(
    INSIGHTS_GENERATE_FEATURE_PERMISSION,
    request,
    { allowAgentBearerToken: true }
  )
  if (!denied) return null
  if (denied.status !== 401) return denied
  if (await isCloudGuestInsightsRequest(request)) return null
  return denied
}
