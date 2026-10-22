/**
 * Opt-in structured `details` for custom webhook targets (#4049). Pure: derives
 * trend / repeatCount / firstFiredAt from the state record read BEFORE
 * `evaluateAlert`, so it never depends on the not-yet-committed next record.
 */

import type { AlertDetails } from './../../adapters'
import type {
  AlertDecisionKind,
  AlertStateRecord,
} from './../../alert-state-store'

export function buildAlertDetails(params: {
  kind: AlertDecisionKind
  value: number | null
  previousValue: number | undefined
  previousState: AlertStateRecord | undefined
  /** ISO-8601 time of this dispatch; the start of a brand-new incident. */
  now: string
}): AlertDetails {
  const { kind, value, previousValue, previousState, now } = params
  let trend: AlertDetails['trend'] = null
  if (value !== null && previousValue !== undefined) {
    trend =
      value > previousValue
        ? 'rising'
        : value < previousValue
          ? 'falling'
          : 'flat'
  }
  const firstFired =
    kind === 'new' ? now : (previousState?.firstFiredAt ?? undefined)
  return {
    trend,
    repeatCount: previousState?.repeatCount ?? 0,
    firstFiredAt:
      typeof firstFired === 'number'
        ? new Date(firstFired).toISOString()
        : (firstFired ?? null),
  }
}
