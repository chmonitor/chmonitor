/**
 * Authentication for webhook subscription storage.
 * Subscriptions are scoped to the signed-in Clerk user — never shared org-wide.
 * Mirrors `lib/connection-store/auth.ts`.
 */

import { resolveUserId } from '@/lib/conversation-store/auth'
import { ConversationStoreError } from '@/lib/conversation-store/types'

/**
 * Resolves the current Clerk user id for webhook subscription operations.
 * Fails closed when auth is missing or invalid.
 */
export async function resolveSubscriptionUserId(): Promise<string> {
  try {
    return await resolveUserId()
  } catch (error) {
    if (
      error instanceof ConversationStoreError &&
      error.code === 'UNAUTHORIZED'
    ) {
      throw new ConversationStoreError(
        'Authentication is required for webhook subscriptions.',
        'UNAUTHORIZED',
        error
      )
    }
    throw error
  }
}
