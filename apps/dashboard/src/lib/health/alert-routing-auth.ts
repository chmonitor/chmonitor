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
 * So resolution here NEVER throws: {@link resolveAlertRoutingOwnerId} always
 * returns a string, falling back to `''` when Clerk isn't configured or the
 * caller isn't signed in. Writes then apply their own policy via
 * {@link requireOwnerForWrite}: in cloud mode (Clerk configured) an
 * anonymous `''` owner is rejected for POST/DELETE — you must sign in to
 * create/delete a route — while self-hosted (no Clerk at all) keeps working
 * anonymously, matching the existing GET behavior.
 */

import { isClerkAuthProvider } from '@/lib/auth/provider'
import { resolveUserId } from '@/lib/conversation-store/auth'

/** OSS single-tenant fallback owner id, shared with `dashboards.owner_id`. */
export const SINGLE_TENANT_OWNER_ID = ''

/**
 * Resolve the caller's owner id for alert-routing reads/writes. Never
 * throws — any resolution failure (no Clerk configured, no session, Clerk
 * API error) falls back to {@link SINGLE_TENANT_OWNER_ID}.
 */
export async function resolveAlertRoutingOwnerId(): Promise<string> {
  try {
    return await resolveUserId()
  } catch {
    return SINGLE_TENANT_OWNER_ID
  }
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
