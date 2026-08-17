import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { AGENT_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import {
  authorizeFeatureRequest,
  isAnonymousPublicReadRequest,
} from '@/lib/feature-permissions/server'

/**
 * Cloud anonymous visitors may hit these agent surfaces only. Other write
 * routes (actions, SQL console, conversations, user-connections, MCP probe,
 * AnyRouter OAuth) stay Clerk-gated. Do not flip AGENT access to `public` —
 * Clerk public-read still 401s unsigned writes.
 */
const CLOUD_GUEST_AGENT_PATHS = new Set([
  '/api/v1/agent',
  '/api/v1/agents/models',
  '/api/v1/agents/config-check',
  '/api/v1/agent/followups',
])

function isCloudGuestAgentPath(request: Request): boolean {
  try {
    return CLOUD_GUEST_AGENT_PATHS.has(new URL(request.url).pathname)
  } catch {
    return false
  }
}

/**
 * Cloud + public-read + unsigned → allow the demo-host agent chat only.
 * Does not grant `anonymousCapabilities.write`.
 */
export async function isCloudGuestAgentRequest(
  request: Request
): Promise<boolean> {
  if (!isCloudModeServer()) return false
  if (!isCloudGuestAgentPath(request)) return false
  return isAnonymousPublicReadRequest(request)
}

export async function authorizeAgentApiRequest(
  request: Request
): Promise<Response | null> {
  const denied = await authorizeFeatureRequest(
    AGENT_FEATURE_PERMISSION,
    request,
    { allowAgentBearerToken: true }
  )
  if (!denied) return null
  if (denied.status !== 401) return denied
  if (await isCloudGuestAgentRequest(request)) return null
  return denied
}
