/**
 * One subscription for "which health metrics already alert?", shared by the
 * whole `/health` page instead of per card (every card would otherwise open its
 * own `health-thresholds` listener and query hooks).
 *
 * `availability` comes from `useHealthStoreAvailability()`: the
 * `capabilities.health` answer in `GET /api/v1/config`, resolved server-side
 * with the same `resolveHealthBackend()` the stores use (not
 * `metadataDb.available`, which also counts a ClickHouse state backend the
 * alert stores cannot use). The custom-rule list is passed as a probe: a
 * `501 NOT_CONFIGURED` forces `unavailable`, so the two never disagree in the
 * direction that would enable a write. Until config answers it is `unknown`,
 * which renders disabled.
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
   * The grid's live `health-thresholds` snapshot; `null` means "not read yet".
   * Reuses the grid's subscription rather than opening a second one.
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
