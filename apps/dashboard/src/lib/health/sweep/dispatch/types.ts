/**
 * Public types of the sweep's dispatch pipeline (#2938).
 *
 * Split out of the former single-file `sweep/dispatch.ts` so the orchestrator
 * (`./index.ts`), the digest layer (`./digest.ts`) and the per-channel modules
 * (`./channels/*`) can share them without importing each other.
 */

import type { Severity } from './../suppression'

export interface DispatchFindingParams {
  hostId: number
  hostName: string
  ruleId: string
  /** Rule type (base rules) or `'compound'` — matched by `resolveTargets`. */
  ruleType: string
  ruleTitle: string
  severity: Severity
  value: number | null
  label: string
  /** Thresholds that classified this finding, when known (base rules only). */
  warnThreshold?: number | null
  critThreshold?: number | null
}

/** Every dispatch-side counter the sweep summary reports. */
export interface DispatchCounters {
  alertsDispatched: number
  alertsSuppressed: number
  maintenanceSuppressed: number
  quietHoursSuppressed: number
  ackedSuppressed: number
  recoveries: number
  emailsDispatched: number
  digestBuffered: number
  digestFlushed: number
}

export interface Dispatcher {
  dispatchFinding: (params: DispatchFindingParams) => Promise<void>
  flushDigests: () => Promise<void>
  counters: DispatchCounters
}
