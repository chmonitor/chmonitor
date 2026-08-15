import {
  applyPresetToDefaults,
  isThresholdOverridden,
  matchPreset,
  THRESHOLD_PRESETS,
} from '../threshold-presets'
import { describe, expect, test } from 'bun:test'

describe('applyPresetToDefaults', () => {
  test('balanced reproduces the check defaults exactly', () => {
    // A preset that shifted the defaults would silently retune every check the
    // operator never touched.
    for (const defaults of [
      { warning: 1, critical: 3 },
      { warning: 150, critical: 300 },
      { warning: 0.5, critical: 0.9 },
    ]) {
      expect(applyPresetToDefaults(defaults, 1)).toEqual(defaults)
    }
  })

  test('scales proportionally per check, not by a shared absolute step', () => {
    expect(applyPresetToDefaults({ warning: 150, critical: 300 }, 0.6)).toEqual(
      {
        warning: 90,
        critical: 180,
      }
    )
    expect(applyPresetToDefaults({ warning: 150, critical: 300 }, 1.6)).toEqual(
      {
        warning: 240,
        critical: 480,
      }
    )
  })

  test('never floors a count threshold to zero', () => {
    // warning: 0 would make the check fire permanently.
    expect(applyPresetToDefaults({ warning: 1, critical: 3 }, 0.6)).toEqual({
      warning: 1,
      critical: 2,
    })
  })

  test('keeps critical ≥ warning so the save validation can never fail', () => {
    for (const preset of THRESHOLD_PRESETS) {
      const result = applyPresetToDefaults(
        { warning: 1, critical: 1 },
        preset.factor
      )
      expect(result.critical).toBeGreaterThanOrEqual(result.warning)
    }
  })
})

describe('isThresholdOverridden', () => {
  const defaults = { warning: 10, critical: 20 }

  test('an absent entry is not an override', () => {
    expect(isThresholdOverridden(undefined, defaults)).toBe(false)
  })

  test('a stored entry equal to the defaults is not an override', () => {
    // A global preset writes all 16 keys; comparing by key presence would show
    // every check as tuned.
    expect(isThresholdOverridden({ warning: 10, critical: 20 }, defaults)).toBe(
      false
    )
  })

  test('a differing value is an override', () => {
    expect(isThresholdOverridden({ warning: 5, critical: 20 }, defaults)).toBe(
      true
    )
  })
})

describe('matchPreset', () => {
  const defaults = { warning: 150, critical: 300 }

  test('recognizes each preset it produced', () => {
    for (const preset of THRESHOLD_PRESETS) {
      const applied = applyPresetToDefaults(defaults, preset.factor)
      expect(matchPreset(applied, defaults)).toBe(preset.id)
    }
  })

  test('a hand-tuned pair matches nothing', () => {
    expect(
      matchPreset({ warning: 137, critical: 291 }, defaults)
    ).toBeUndefined()
  })
})
