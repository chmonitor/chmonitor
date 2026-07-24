/**
 * Clerk user metrics for the daily digest — total users + new users in the last
 * 24h, read from the Clerk Backend REST API with the existing CLERK_SECRET_KEY.
 *
 * Uses the `GET /v1/users/count` endpoint (which accepts the same filters as the
 * list endpoint) so we never page the whole user list. Everything is
 * best-effort: no key, a non-2xx, or a network error → `null`, and the digest
 * simply omits the Users section (graceful degradation, like the rest of the
 * worker).
 */

import type { ClerkMetrics } from './summary'

const CLERK_API = 'https://api.clerk.com/v1'

async function countUsers(
  auth: Record<string, string>,
  fetchImpl: typeof fetch,
  query = ''
): Promise<number | null> {
  const res = await fetchImpl(`${CLERK_API}/users/count${query}`, {
    headers: auth,
  })
  if (!res.ok) {
    console.error('[cloud-hooks] Clerk users/count non-2xx', {
      status: res.status,
      query,
    })
    return null
  }
  const body = (await res.json()) as { total_count?: number }
  return typeof body.total_count === 'number' ? body.total_count : null
}

/** 24 hours — the daily digest's window, and the default here. */
export const DAY_SECONDS = 24 * 60 * 60
/** 7 days — the weekly report's window. */
export const WEEK_SECONDS = 7 * DAY_SECONDS

/**
 * Fetch `{ totalUsers, newUsers, windowSeconds }` or null when unavailable.
 * `now` is unix seconds (injectable for tests); `windowSeconds` sets how far
 * back "new" reaches (24h for the daily digest, 7d for the weekly report) and
 * is passed to Clerk as `created_at_after` in unix MILLIseconds. It is carried
 * on the result so the formatter labels the number from the same value that
 * produced it and the two can never drift.
 */
export async function fetchClerkMetrics(
  secretKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: number = Math.floor(Date.now() / 1000),
  windowSeconds: number = DAY_SECONDS
): Promise<ClerkMetrics | null> {
  if (!secretKey) {
    console.log(
      '[cloud-hooks] CLERK_SECRET_KEY unset; digest omits user counts'
    )
    return null
  }
  const auth = { authorization: `Bearer ${secretKey}` }
  try {
    const total = await countUsers(auth, fetchImpl)
    if (total === null) return null
    const sinceMs = (now - windowSeconds) * 1000
    const recent = await countUsers(
      auth,
      fetchImpl,
      `?created_at_after=${sinceMs}`
    )
    return { totalUsers: total, newUsers: recent ?? 0, windowSeconds }
  } catch (err) {
    console.error('[cloud-hooks] Clerk metrics fetch failed', err)
    return null
  }
}
