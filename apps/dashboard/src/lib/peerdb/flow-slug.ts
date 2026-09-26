/**
 * Stable flow-name slug, shared by every PeerDB per-entity identity.
 *
 * A mirror's slug is what makes a per-mirror **id** stable across regenerations:
 * the alert rule id (`peerdb-mirror-health:<slug>`,
 * `lib/peerdb/alert-cycle.ts`) and the per-mirror insight metric
 * (`peerdb_mirror_errors:<slug>`, `lib/insights/peerdb-checks.ts`) must both
 * resolve the same flow to the same token, or a dismissal and an ACK would be
 * filed against two different identities for the same mirror.
 *
 * Lives in its own leaf module because `alert-cycle.ts` is server-side (it
 * pulls in `@chm/logger` and the D1-backed alert state store) while
 * `peerdb-checks.ts` is a pure, dependency-free classifier that must stay
 * importable from a unit test.
 */

/** Charset kept to `[a-z0-9_-]` so route globs (`peerdb*`) still match. */
const MAX_SLUG_LENGTH = 64

/**
 * Lowercase, collapse everything outside `[a-z0-9_-]` to `-`, trim the dashes,
 * and bound the length. Falls back to `unnamed` for an empty result so an id is
 * never empty (which would collapse `base:` onto the base id).
 */
export function peerDBFlowSlug(flowName: string): string {
  const slug = flowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
  return slug || 'unnamed'
}
