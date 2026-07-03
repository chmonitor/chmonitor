/**
 * Owner resolution for custom alert rules (plan 32).
 *
 * Unlike webhook subscriptions (Clerk-only, cloud feature), custom alert
 * rules are a core monitoring feature and must keep working self-hosted
 * without Clerk — see root CLAUDE.md "Self-hosted stays whole". When Clerk
 * IS configured, writes stay auth-gated (a signed-out request is rejected,
 * preserving per-user isolation for cloud). When Clerk is NOT configured
 * (typical self-hosted deployment), every request resolves to one fixed
 * single-tenant owner id — there is only one operator, so no isolation is
 * needed or possible.
 */

import { isClerkAuthProvider } from '@/lib/auth/provider'
import { resolveUserId } from '@/lib/conversation-store/auth'

/** Fixed owner id used when Clerk auth is not configured (self-hosted). */
export const OSS_SINGLE_TENANT_OWNER_ID = 'oss'

/**
 * Resolves the owner id to scope a custom alert rule read/write to.
 * Throws (via `resolveUserId`) only when Clerk IS configured but the caller
 * is not signed in — self-hosted deployments without Clerk never throw.
 */
export async function resolveCustomRuleOwnerId(): Promise<string> {
  if (!isClerkAuthProvider() || !process.env.CLERK_SECRET_KEY) {
    return OSS_SINGLE_TENANT_OWNER_ID
  }
  return resolveUserId()
}
