/**
 * Authentication utilities for conversation store.
 */

import { ConversationStoreError } from './types'
// @clerk/tanstack-react-start/server@1.3.2 exports `auth` (no-request
// signature, GetAuthFnNoRequest) — not `getAuth(request)`.
import { auth } from '@clerk/tanstack-react-start/server'
import { getAuthProvider, isClerkAuthProvider } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'

export const GUEST_USER_ID = 'guest'

const CLERK_SECRET_KEY = 'CLERK_SECRET_KEY'

/**
 * Resolves the current user ID from Clerk authentication.
 *
 * Conversation DB endpoints must be authenticated to guarantee user isolation.
 * This function fails closed when Clerk is unavailable, missing a session,
 * or returns an auth error.
 */
// request parameter kept for callers that pass it; the TSR clerk sdk's `auth()`
// does not accept a request argument (it reads from the ambient request context).
export async function resolveUserId(_request?: Request): Promise<string> {
  if (!isClerkAuthProvider() || !process.env[CLERK_SECRET_KEY]) {
    throw new ConversationStoreError(
      'Authentication is required for conversation storage.',
      'UNAUTHORIZED'
    )
  }

  try {
    const authResult = await auth()
    const userId = authResult?.userId

    if (!userId) {
      throw new ConversationStoreError(
        'Authentication is required for conversation storage.',
        'UNAUTHORIZED'
      )
    }

    return userId
  } catch (error) {
    if (error instanceof ConversationStoreError) {
      throw error
    }

    if (process.env.NODE_ENV === 'development') {
      console.error('Auth resolution failed:', error)
    }

    throw new ConversationStoreError(
      'Failed to validate authentication for conversation storage.',
      'UNAUTHORIZED',
      error
    )
  }
}

/** Prefix that keeps trusted-proxy subjects apart from Clerk user ids. */
export const TRUSTED_USER_ID_PREFIX = 'trusted:'

/**
 * Resolves the conversation owner for the active identity source (#4227).
 *
 * Clerk deployments keep `resolveUserId`. Under `CHM_AUTH_PROVIDER=trusted`
 * the subject comes from the trusted provider (which enforces its
 * shared-secret / insecure opt-in), namespaced as `trusted:<subject>`.
 * Anything else fails closed with UNAUTHORIZED.
 */
export async function resolveConversationUserId(
  request: Request
): Promise<string> {
  const provider = getAuthProvider()
  if (provider === 'clerk') return resolveUserId(request)

  if (provider === 'trusted') {
    let subject: string | undefined
    try {
      const result =
        await resolveServerAuthProvider('trusted').authenticateRequest(request)
      subject = result.authenticated ? result.subject?.trim() : undefined
    } catch (error) {
      throw new ConversationStoreError(
        'Failed to validate authentication for conversation storage.',
        'UNAUTHORIZED',
        error
      )
    }
    if (subject) return `${TRUSTED_USER_ID_PREFIX}${subject}`
  }

  throw new ConversationStoreError(
    'Authentication is required for conversation storage.',
    'UNAUTHORIZED'
  )
}
