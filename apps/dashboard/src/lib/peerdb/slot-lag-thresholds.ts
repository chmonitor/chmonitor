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

/**
 * Growth thresholds, MiB, over the lag-history window.
 *
 * A slot parked *below* `SLOT_LAG_WARN_MB` but climbing is the case
 * `checkSlotLag` structurally cannot catch: it reads one instantaneous reading,
 * so 400 MiB rising to 900 MiB never crosses the 512 MiB line on a sweep that
 * happens to run early. These are absolute MiB *deltas* between the first and
 * last point of the window, not levels — deliberately, so the signal does not
 * double-count what `SLOT_LAG_WARN_MB` already covers.
 */

/** Growth at/above which a rising slot is `warning`. */
export const SLOT_LAG_TREND_WARN_MB = 128

/** Growth at/above which a rising slot is `critical`. */
export const SLOT_LAG_TREND_CRITICAL_MB = 512

/**
 * Minimum usable history points. Below this a "trend" is two readings and any
 * conclusion is noise, so the check declines to fire at all.
 */
export const SLOT_LAG_TREND_MIN_POINTS = 4
