/**
 * One subscription for "which health metrics already alert?" (#3437).
 *
 * The three sources behind `resolveMetricAlertSignals` are collected here once
 * for the whole `/health` page rather than per card: every card would otherwise
 * open its own `health-thresholds` listener and its own copy of the same two
 * React Query keys (deduped, but still 17 hook instances churning).
 *
 * ## Why availability is probed, not declared
 *
 * The D1-backed custom-rule store answers `501` when `CHM_CLOUD_D1` is unbound.
 * `metadataDb.available` in `GET /api/v1/config` is NOT a substitute: it counts
 * `DATABASE_URL` / `POSTGRES_URL` as satisfying, while every alert store is
 * D1-only, so a Postgres-only self-host reports `available === true` and then
 * gets a 501 on write. Rather than invent a second, contradictory signal, this
 * hook reuses the store's own `NOT_CONFIGURED` answer — the same 501 probe
 * `RuleBuilderPanel` already uses — and keeps the UI in an explicit `unknown`
 * state until it lands, so a D1-less deploy is never shown a falsely-enabled
 * "available" affordance.
 */

import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type { AlertStateRow } from '@/lib/health/alert-state-persist'
import type { ThresholdsMap } from '@/lib/health/thresholds-storage'
import type { FetchError } from '@/lib/swr/fetch-error'

import { useAlertState } from './use-alert-state'
import { useMemo } from 'react'
import { resolveMetricAlertSignals } from '@/lib/health/alert-capability'
import { useCustomAlertRules } from '@/lib/hooks/use-custom-alert-rules'

/**
 * What the custom-rule store can do on this deployment. `unknown` is a real
 * state, not a convenience: it is what keeps the "save as a named alert"
 * affordance from flashing enabled on a D1-less deploy.
 */
export type AlertRuleStoreAvailability = 'unknown' | 'available' | 'unavailable'

/** True when an API error is the store's explicit `NOT_CONFIGURED` (HTTP 501). */
export function isNotConfiguredError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as FetchError).status === 501
  )
}

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
  const {
    rules,
    error: rulesError,
    isLoading: rulesLoading,
  } = useCustomAlertRules()
  const { states, error: stateError } = useAlertState()

  const ruleMetrics = useMemo(() => rules.map((r) => r.metric), [rules])

  // A failed state read must not invent a false "no state row"; it just means
  // the `state` source is unavailable, and the other two still answer.
  const alertStates: readonly AlertStateRow[] | undefined = stateError
    ? undefined
    : states

  const availability: AlertRuleStoreAvailability = rulesLoading
    ? 'unknown'
    : isNotConfiguredError(rulesError)
      ? 'unavailable'
      : rulesError
        ? 'unknown'
        : 'available'

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
