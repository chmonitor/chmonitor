/**
 * Canonical PeerDB replication-slot lag thresholds (MiB).
 *
 * Single source of truth shared by the fleet UI (`slotHealth` in
 * `components/peerdb/peerdb-derive`) and the AI-insights classifiers
 * (`checkSlotLag` in `lib/insights/peerdb-checks`) so the slot-health table
 * and the insights panel always agree on what "lagging" means. Lives in `lib`
 * (not components) so both server collectors and client components can import
 * it without a layering inversion.
 */

/** Lag at/above which a slot is `warn` — worth surfacing, not yet paging. */
export const SLOT_LAG_WARN_MB = 512

/** Lag at/above which a slot is `critical` — source disk pressure risk. */
export const SLOT_LAG_CRITICAL_MB = 2048
