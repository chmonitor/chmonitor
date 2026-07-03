/**
 * Authentication for dashboard storage (server-only).
 * Dashboards are scoped to the signed-in Clerk user — never shared org-wide.
 *
 * Mirrors `connection-store/auth.ts`: a thin wrapper around
 * `conversation-store/auth.ts`'s `resolveUserId`, translating its error type
 * to this domain's `DashboardStoreError`. Reused rather than forked — see
 * plans/56-dashboard-d1-persistence-sharing.md.
 */

import { DashboardStoreError } from './types'
import { resolveUserId } from '@/lib/conversation-store/auth'
import { ConversationStoreError } from '@/lib/conversation-store/types'

/**
 * Resolves the current Clerk user id for dashboard store operations.
 * Fails closed when auth is missing or invalid.
 */
export async function resolveDashboardOwnerId(
  request?: Request
): Promise<string> {
  try {
    return await resolveUserId(request)
  } catch (error) {
    if (
      error instanceof ConversationStoreError &&
      error.code === 'UNAUTHORIZED'
    ) {
      throw new DashboardStoreError(
        'Authentication is required for dashboard storage.',
        'UNAUTHORIZED',
        error
      )
    }
    throw error
  }
}
