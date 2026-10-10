/**
 * PeerDB alert thresholds: pure types + defaults. Kept free of imports so
 * client components can use them without pulling `alerting.ts` (whose audit
 * path dynamically imports server-only stores) into the browser bundle.
 */

export interface PeerDBAlertThresholds {
  /** CDC lag seconds at/above which the mirror is `warning`. Default 300. */
  lagWarnSec: number
  /** CDC lag seconds at/above which the mirror is `error`. Default 1800. */
  lagErrorSec: number
  /** Slot lag MB at/above which the mirror is `warning`. Default 512. */
  slotLagWarnMb: number
  /** Slot lag MB at/above which the mirror is `error`. Default 2048. */
  slotLagErrorMb: number
  /** Recent error count at/above which the mirror is `warning`. Default 1. */
  errorWarnCount: number
  /** Recent error count at/above which the mirror is `error`. Default 5. */
  errorErrorCount: number
  /**
   * Seconds since `lastSyncedAtMs` at/above which a RUNNING mirror with no
   * `lagSec` is `warning`. Default 1800.
   */
  staleSyncWarnSec: number
  /** Same, for `error`. Default 7200. */
  staleSyncErrorSec: number
}

export const DEFAULT_PEERDB_ALERT_THRESHOLDS: PeerDBAlertThresholds = {
  lagWarnSec: 300,
  lagErrorSec: 1800,
  slotLagWarnMb: 512,
  slotLagErrorMb: 2048,
  errorWarnCount: 1,
  errorErrorCount: 5,
  staleSyncWarnSec: 1800,
  staleSyncErrorSec: 7200,
}
