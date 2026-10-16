import { createErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { isAuthenticatedRequest } from '@/lib/auth/api-guard'

/**
 * Sign-in check for routes that use the server-held PeerDB credential.
 *
 * Call it only AFTER the not-configured response has been returned, so a
 * deployment without PeerDB answers every caller the same way and the check
 * only applies where PeerDB is actually configured.
 *
 * Returns a 401 Response when the caller is not signed in, else null.
 */
export async function requirePeerDBSignIn(
  request: Request,
  route: string
): Promise<Response | null> {
  if (await isAuthenticatedRequest(request)) return null
  return createErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message: 'Sign in to view PeerDB data',
    },
    401,
    { route, method: request.method }
  )
}
