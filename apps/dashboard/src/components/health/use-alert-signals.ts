/**
 * One subscription for "which health metrics already alert?" (#3437).
 *
 * The three sources behind `resolveMetricAlertSignals` are collected here once
 * for the whole `/health` page rather than per card: every card would otherwise
 * open its own `health-thresholds` listener and its own copy of the same two
 * React Query keys (deduped, but still 17 hook instances churning).
 *
 * ## Availability: declared capability, with the probe as a veto
 *
 * `availability` comes from `useHealthStoreAvailability()` (#3495): the
 * `capabilities.health` answer in `GET /api/v1/config`, which the server
 * resolves with the same `resolveHealthBackend()` call the stores use — not
 * `metadataDb.available`, which also counts a ClickHouse state backend the
 * alert stores cannot use (#3493). The custom-rule list is still passed as the
 * probe: a `501 NOT_CONFIGURED` from it forces `unavailable`, so the two can
 * never disagree in the direction that would enable a write. Until the config
 * answers, the state is `unknown`, which renders disabled.
 */

import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type { AlertStateRow } from '@/lib/health/alert-state-persist'
import type { ThresholdsMap } from '@/lib/health/thresholds-storage'

import { useAlertState } from './use-alert-state'
import { useMemo } from 'react'
import { resolveMetricAlertSignals } from '@/lib/health/alert-capability'
import {
  type HealthStoreAvailability,
  useHealthStoreAvailability,
} from '@/lib/health/store-availability'
import { useCustomAlertRules } from '@/lib/hooks/use-custom-alert-rules'

export { isNotConfiguredError } from '@/lib/health/store-availability'

/**
 * What the custom-rule store can do on this deployment. `unknown` is a real
 * state, not a convenience: it is what keeps the "save as a named alert"
 * affordance from flashing enabled on a deploy with no alert backend.
 */
export type AlertRuleStoreAvailability = HealthStoreAvailability

export interface UseAlertSignalsResult {
  /** Resolved per check id. Absent until the first render resolves a value. */
  signalsByCheck: ReadonlyMap<string, MetricAlertSignals>
  /**
   * True while the `localStorage` map has not been read yet. The server sources
   * are deliberately NOT part of this: the indicator must appear (from local
   * thresholds alone) on a deployment with no metadata database.
   */
  isLoading: boolean
  availability: AlertRuleStoreAvailability
}

export function useAlertSignals(
  checkIds: readonly string[],
  /**
   * The grid's live `health-thresholds` snapshot. `null` means "not read yet",
   * which keeps the badge out of the UI for the single frame before
   * localStorage resolves. The grid already owns that subscription, so this
   * hook reuses it rather than opening a second one.
   */
  thresholds: ThresholdsMap | null
): UseAlertSignalsResult {
  const { rules, error: rulesError } = useCustomAlertRules()
  const { states, error: stateError } = useAlertState()

  const ruleMetrics = useMemo(() => rules.map((r) => r.metric), [rules])

  // A failed state read must not invent a false "no state row"; it just means
  // the `state` source is unavailable, and the other two still answer.
  const alertStates: readonly AlertStateRow[] | undefined = stateError
    ? undefined
    : states

  const availability: AlertRuleStoreAvailability = useHealthStoreAvailability({
    probeError: rulesError,
  })

  const signalsByCheck = useMemo(() => {
    const out = new Map<string, MetricAlertSignals>()
    if (!thresholds) return out
    for (const id of checkIds) {
      out.set(
        id,
        resolveMetricAlertSignals({
          checkId: id,
          thresholds,
          customRuleMetrics: ruleMetrics,
          alertStates,
        })
      )
    }
    return out
  }, [checkIds, thresholds, ruleMetrics, alertStates])

  return { signalsByCheck, isLoading: thresholds === null, availability }
}

/** Signals for a single check, defaulting to "nothing configured". */
export const NO_ALERT_SIGNALS: MetricAlertSignals = {
  configured: false,
  sources: [],
  catalogMetric: null,
  lastState: null,
}

export function signalsForCheck(
  signalsByCheck: ReadonlyMap<string, MetricAlertSignals>,
  checkId: string
): MetricAlertSignals {
  return signalsByCheck.get(checkId) ?? NO_ALERT_SIGNALS
}
