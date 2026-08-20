/**
 * Preset invariants against the REAL `HEALTH_CHECKS`, not synthetic pairs.
 *
 * The Thresholds tab applies a preset to every health check at once and then hands
 * the result to `handleSave`, which rejects any check whose warning exceeds its
 * critical. If a preset can produce that pair for any real check, the UI writes
 * a state its own save button refuses — so this sweeps the whole matrix rather
 * than spot-checking.
 */

import {
  applyPresetToDefaults,
  matchPreset,
  THRESHOLD_PRESETS,
} from '../threshold-presets'
import { describe, expect, test } from 'bun:test'
import { HEALTH_CHECKS } from '@/components/health/health-checks'

describe('presets over every real health check', () => {
  test('the check set is non-empty and every check has defaults', () => {
    // Guards the sweeps below from passing vacuously.
    expect(HEALTH_CHECKS.length).toBeGreaterThan(0)
    for (const check of HEALTH_CHECKS) {
      expect(Number.isFinite(check.defaults.warning)).toBe(true)
      expect(Number.isFinite(check.defaults.critical)).toBe(true)
    }
  })

  test('no preset can produce warning > critical for any check', () => {
    for (const check of HEALTH_CHECKS) {
      for (const preset of THRESHOLD_PRESETS) {
        const result = applyPresetToDefaults(check.defaults, preset.factor)
        expect({
          check: check.id,
          preset: preset.id,
          ok: result.warning <= result.critical,
        }).toEqual({ check: check.id, preset: preset.id, ok: true })
      }
    }
  })

  test('no preset floors a count threshold to zero', () => {
    // A warning of 0 on a count check ("readonly replicas ≥ 0") would fire
    // permanently. Only checks whose own default is ≥ 1 are count-like.
    for (const check of HEALTH_CHECKS.filter((c) => c.defaults.warning >= 1)) {
      for (const preset of THRESHOLD_PRESETS) {
        const result = applyPresetToDefaults(check.defaults, preset.factor)
        expect({
          check: check.id,
          preset: preset.id,
          warning: result.warning >= 1,
        }).toEqual({ check: check.id, preset: preset.id, warning: true })
      }
    }
  })

  test('every preset result is a finite number', () => {
    for (const check of HEALTH_CHECKS) {
      for (const preset of THRESHOLD_PRESETS) {
        const result = applyPresetToDefaults(check.defaults, preset.factor)
        expect(Number.isFinite(result.warning)).toBe(true)
        expect(Number.isFinite(result.critical)).toBe(true)
      }
    }
  })

  test('Balanced is a no-op on every check, so a fresh install is unchanged', () => {
    for (const check of HEALTH_CHECKS) {
      expect(applyPresetToDefaults(check.defaults, 1)).toEqual(check.defaults)
    }
  })

  test('a stored all-defaults map reads back as the Balanced preset', () => {
    // This is what drives the segmented control's active state after a reload.
    for (const check of HEALTH_CHECKS) {
      expect(matchPreset(check.defaults, check.defaults)).toBe('balanced')
    }
  })

  test('Sensitive never fires later than Balanced, Relaxed never earlier', () => {
    // The preset labels are a promise about direction; a rounding rule that
    // inverted one for some check would be a silent lie in the UI.
    const factor = (id: string) =>
      THRESHOLD_PRESETS.find((p) => p.id === id)?.factor ?? 1
    for (const check of HEALTH_CHECKS) {
      const sensitive = applyPresetToDefaults(
        check.defaults,
        factor('sensitive')
      )
      const balanced = applyPresetToDefaults(check.defaults, factor('balanced'))
      const relaxed = applyPresetToDefaults(check.defaults, factor('relaxed'))

      expect({
        check: check.id,
        ok: sensitive.warning <= balanced.warning,
      }).toEqual({ check: check.id, ok: true })
      expect({
        check: check.id,
        ok: relaxed.warning >= balanced.warning,
      }).toEqual({ check: check.id, ok: true })
    }
  })

  test('preset ids are unique and include the balanced baseline', () => {
    const ids = THRESHOLD_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('balanced')
    expect(THRESHOLD_PRESETS.find((p) => p.id === 'balanced')?.factor).toBe(1)
  })
})
