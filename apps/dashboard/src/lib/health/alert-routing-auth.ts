/**
 * Owner resolution for the alert-routing CRUD API
 * (`routes/api/v1/health/routes.ts`).
 *
 * Unlike `dashboard-storage/auth.ts` / `lib/events/auth.ts` (which fail
 * CLOSED — no Clerk session means no access at all), alert routing must keep
 * "self-hosted stays whole": a deployment with no Clerk configured is the
 * default OSS case, and it must be able to manage routes with zero auth,
 * scoped under the OSS single-tenant `ownerId = ''` convention shared with
 * `dashboards` / `user_connections`.
 *
 * So in self-hosted, {@link resolveConfigOwner} falls back to `''` when Clerk
 * isn't configured or the caller isn't signed in. In cloud it never returns
 * `''`: no provable owner is a 401. Writes add {@link requiresSignInForWrite},
 * which also rejects `''` on a self-hosted deployment that uses Clerk.
 */

import { jsonError, verifiedChmApiKeySub } from '@/lib/auth/api-guard'
import { isClerkAuthProvider } from '@/lib/auth/provider'
import { resolveBillingOwnerId } from '@/lib/billing/billing-owner'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { resolveUserId } from '@/lib/conversation-store/auth'

/** OSS single-tenant fallback owner id, shared with `dashboards.owner_id`. */
export const SINGLE_TENANT_OWNER_ID = ''

/**
 * Which owner a config row is keyed by: the Clerk user (alert routes,
 * webhooks, digest, reports) or the billing owner, the active org or else the
 * user (quiet hours, maintenance windows, PeerDB rules).
 */
export type ConfigOwnerScope = 'user' | 'billing'

/**
 * Resolve the owner a per-owner config request reads or writes, or a 401.
 *
 * Self-hosted: the session owner when there is one, else
 * {@link SINGLE_TENANT_OWNER_ID}. Never rejects.
 *
 * Cloud: `''` is not a tenant, so it is never returned. The owner is the
 * session owner, or for a `user`-scope read (GET) the subject a `chm_` key
 * was issued to. Writes need a session: not every write route checks key
 * scopes. A key cannot stand in for a billing owner because it carries no org.
 */
export async function resolveConfigOwner(
  request: Request,
  scope: ConfigOwnerScope
): Promise<string | Response> {
  try {
    return scope === 'user'
      ? await resolveUserId()
      : await resolveBillingOwnerId()
  } catch {
    if (!isCloudModeServer()) return SINGLE_TENANT_OWNER_ID
  }
  if (scope === 'user' && request.method === 'GET') {
    const keySub = await verifiedChmApiKeySub(request)
    if (keySub) return keySub
  }
  return jsonError('Authentication required', 401)
}

/**
 * Write-path policy: reject an anonymous owner ONLY when Clerk is the
 * configured auth provider (cloud mode) — self-hosted deployments with no
 * Clerk at all keep writing anonymously under the single-tenant owner.
 * Returns `true` when the write should be rejected (caller must sign in).
 */
export function requiresSignInForWrite(ownerId: string): boolean {
  return isClerkAuthProvider() && ownerId === SINGLE_TENANT_OWNER_ID
}
