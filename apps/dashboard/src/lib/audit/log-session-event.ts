/**
 * Convenience wrapper around {@link logEvent} for routes that act on behalf of
 * the current signed-in session (user-connections, billing checkout) rather
 * than a webhook payload that already carries an org id.
 *
 * Resolves the org id from the session via `resolveBillingOwner()` and no-ops
 * (never throws) when:
 * - the session has no active Clerk org (a free/user-scoped account) — audit
 *   is an org-scoped enterprise feature, so there is nothing to scope it to.
 * - org resolution itself fails for any reason (unauthenticated, Clerk
 *   misconfigured, etc).
 *
 * `logEvent` already fails open on its own (edition gate, missing D1), so this
 * wrapper only adds the org-resolution step and its own best-effort guard —
 * audit must never affect the caller's mutation either way.
 */

import type { AuditEvent } from './logEvent'

import { logEvent } from './logEvent'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'

export async function logSessionEvent(
  event: Omit<AuditEvent, 'orgId'>
): Promise<void> {
  try {
    const owner = await resolveBillingOwner()
    if (owner.type !== 'org') return
    await logEvent({ ...event, orgId: owner.id })
  } catch {
    // Best-effort: org resolution failing must never affect the caller.
  }
}
