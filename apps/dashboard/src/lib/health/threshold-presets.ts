/**
 * Threshold presets — "smart defaults" for the Thresholds tab.
 *
 * The Thresholds tab used to render 16 checks × 2 raw number inputs, which is a
 * wall of forms an operator has no way to reason about. Instead we offer three
 * named sensitivities derived from each check's own `defaults`, so a preset
 * always stays proportional to what the check actually measures (a "parts" count
 * and a "percent" scale should not share one multiplier).
 *
 * Pure — no `window`, no I/O — so the panel and its unit test both use it.
 */

import type { Thresholds } from './thresholds-storage'

export type ThresholdPresetId = 'sensitive' | 'balanced' | 'relaxed'

export interface ThresholdPreset {
  id: ThresholdPresetId
  label: string
  description: string
  /** Multiplier applied to the check's own default warning/critical values. */
  factor: number
}

export const THRESHOLD_PRESETS: readonly ThresholdPreset[] = [
  {
    id: 'sensitive',
    label: 'Sensitive',
    description: 'Fire earlier — catch problems while they are still small',
    factor: 0.6,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description:
      'The built-in defaults, tuned for a typical production cluster',
    factor: 1,
  },
  {
    id: 'relaxed',
    label: 'Relaxed',
    description: 'Fire later — fewer pages on a busy or bursty cluster',
    factor: 1.6,
  },
]

/**
 * Scale one check's defaults by a preset factor.
 *
 * Counts stay whole numbers with a floor of 1 (a "0 readonly replicas" warning
 * would fire permanently); values already below 1 are treated as fractional and
 * kept as-is. `critical` is always clamped to at least `warning`, so a preset
 * can never produce the invalid state the save handler rejects.
 */
export function applyPresetToDefaults(
  defaults: Thresholds,
  factor: number
): Thresholds {
  const scale = (value: number) => {
    const scaled = value * factor
    if (value >= 1) return Math.max(1, Math.round(scaled))
    return Number(scaled.toFixed(2))
  }
  const warning = scale(defaults.warning)
  const critical = Math.max(warning, scale(defaults.critical))
  return { warning, critical }
}

/** True when the stored pair differs from the check's built-in defaults. */
export function isThresholdOverridden(
  current: Thresholds | undefined,
  defaults: Thresholds
): boolean {
  if (!current) return false
  return (
    current.warning !== defaults.warning ||
    current.critical !== defaults.critical
  )
}

/**
 * Which preset (if any) the given pair corresponds to, so the segmented control
 * can render the active choice instead of always looking unset. Returns
 * `undefined` for a hand-tuned pair ("Custom").
 */
export function matchPreset(
  current: Thresholds,
  defaults: Thresholds
): ThresholdPresetId | undefined {
  return THRESHOLD_PRESETS.find((preset) => {
    const expected = applyPresetToDefaults(defaults, preset.factor)
    return (
      expected.warning === current.warning &&
      expected.critical === current.critical
    )
  })?.id
}
