/**
 * Fact helpers shared by the adapters (pure).
 *
 * Every channel renders the same facts about an alert (value, thresholds, how
 * long an incident has been open or fired); these produce the plain strings.
 * Callers escape them for their own markup.
 */

import type { AlertPayload } from './types'

type ValueFields = Pick<AlertPayload, 'value'>
type ThresholdFields = Pick<AlertPayload, 'warnThreshold' | 'critThreshold'>

/** The observed value, or `n/a` when unavailable. */
export function valueText(payload: ValueFields): string {
  return payload.value === null ? 'n/a' : String(payload.value)
}

/** `['warn 80', 'crit 90']`, only the thresholds that are set. */
export function thresholdParts(payload: ThresholdFields): string[] {
  const parts: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    parts.push(`warn ${payload.warnThreshold}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    parts.push(`crit ${payload.critThreshold}`)
  }
  return parts
}

/** `warn 80 | crit 90`, or an em dash when no threshold is set. */
export function thresholdText(payload: ThresholdFields): string {
  const parts = thresholdParts(payload)
  return parts.length > 0 ? parts.join(' | ') : '—'
}
