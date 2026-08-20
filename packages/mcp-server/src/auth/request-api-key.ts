/**
 * Extract programmatic API-key candidates from a request.
 *
 * An API key may arrive as `x-api-key` OR `Authorization: Bearer chm_…`.
 * Keep them distinct so a bad Bearer never masks a valid x-api-key (and so
 * Clerk OAuth verifiers never receive an x-api-key as if it were an OAuth token).
 */

import { getBearerToken } from './bearer-token'

export function getRequestApiKeyCandidates(request: Request): {
  bearer: string | null
  apiKeyHeader: string | null
} {
  return {
    bearer: getBearerToken(request.headers.get('authorization')),
    apiKeyHeader: request.headers.get('x-api-key'),
  }
}

/** Ordered unique candidates to try against `verifyApiKey` (x-api-key first). */
export function apiKeyCandidates(request: Request): string[] {
  const { bearer, apiKeyHeader } = getRequestApiKeyCandidates(request)
  const out: string[] = []
  if (apiKeyHeader) out.push(apiKeyHeader)
  if (bearer && bearer !== apiKeyHeader) out.push(bearer)
  return out
}
