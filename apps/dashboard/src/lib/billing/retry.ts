/**
 * Shared retry policy for the client-side billing queries.
 *
 * Billing calls (`/api/v1/billing/subscription`, `/api/v1/billing/usage`) can
 * legitimately fail transiently right after a cold load, while the short-lived
 * Clerk `__session` cookie is still being refreshed — so a bounded retry is
 * worth it. But a `401`/`403` is DETERMINISTIC: on self-hosted / OSS (no Clerk
 * owner) the route can never resolve a billing owner, so every retry returns the
 * same 401. Retrying then only floods the console and Sentry. This predicate
 * keeps the bounded retry for everything EXCEPT an auth failure, which it gives
 * up on immediately.
 */

const MAX_BILLING_RETRIES = 5

/** Extract an HTTP status from a thrown billing error, if one is present. */
export function billingErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null

  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && Number.isFinite(status)) return status

  // Fallback for errors that only carry the status inside their message
  // (e.g. `new Error('Usage request failed (401)')`).
  const message = (error as { message?: unknown }).message
  if (typeof message === 'string') {
    const match = message.match(/\((\d{3})\)/)
    if (match) return Number(match[1])
  }

  return null
}

/** True for a deterministic auth failure that retrying can never fix. */
export function isBillingAuthError(error: unknown): boolean {
  const status = billingErrorStatus(error)
  return status === 401 || status === 403
}

/**
 * TanStack Query `retry` predicate: retry up to {@link MAX_BILLING_RETRIES}
 * times, but never on a `401`/`403`.
 */
export function retryBillingUnlessAuthError(
  failureCount: number,
  error: unknown
): boolean {
  if (isBillingAuthError(error)) return false
  return failureCount < MAX_BILLING_RETRIES
}
