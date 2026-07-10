import {
  detectCloudModeMismatch,
  isCloudModeServer,
  parseCloudMode,
} from './cloud-mode'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// parseCloudMode — fail-closed to self-hosted (false) for anything unexpected.
// ---------------------------------------------------------------------------
describe('parseCloudMode', () => {
  test('undefined → false', () => {
    expect(parseCloudMode(undefined)).toBe(false)
  })

  test('null → false', () => {
    expect(parseCloudMode(null)).toBe(false)
  })

  test('empty / whitespace → false', () => {
    expect(parseCloudMode('')).toBe(false)
    expect(parseCloudMode('   ')).toBe(false)
  })

  test('junk → false', () => {
    expect(parseCloudMode('yes')).toBe(false)
    expect(parseCloudMode('on')).toBe(false)
    expect(parseCloudMode('enterprise')).toBe(false)
  })

  test('true / 1 / cloud (case-insensitive, trimmed) → true', () => {
    expect(parseCloudMode('true')).toBe(true)
    expect(parseCloudMode('TRUE')).toBe(true)
    expect(parseCloudMode('  True  ')).toBe(true)
    expect(parseCloudMode('1')).toBe(true)
    expect(parseCloudMode('cloud')).toBe(true)
    expect(parseCloudMode('CLOUD')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isCloudModeServer — runtime CHM_CLOUD_MODE wins over build-time inline.
// ---------------------------------------------------------------------------
describe('isCloudModeServer', () => {
  test('runtime CHM_CLOUD_MODE=true → true', () => {
    expect(isCloudModeServer({ CHM_CLOUD_MODE: 'true' })).toBe(true)
  })

  test('runtime unset → falls back to build-time (false in tests)', () => {
    // VITE_CLOUD_MODE is unset in the test env, so the fallback is false.
    expect(isCloudModeServer({})).toBe(false)
  })

  test('runtime junk → false (does not lock out self-hosted)', () => {
    expect(isCloudModeServer({ CHM_CLOUD_MODE: 'maybe' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectCloudModeMismatch — split-brain guard for prebuilt bundles.
// The `clientBuildValue` arg stands in for the baked-in VITE_CLOUD_MODE so the
// build-time half can be varied under test.
// ---------------------------------------------------------------------------
describe('detectCloudModeMismatch', () => {
  test('OSS bundle + runtime cloud flag → mismatch (the reported defect)', () => {
    const result = detectCloudModeMismatch(
      { CHM_DEPLOYMENT_MODE: 'cloud' },
      false // client bundle built without VITE_CLOUD_MODE
    )
    expect(result).toEqual({ server: true, clientBuild: false, mismatch: true })
  })

  test('runtime CHM_CLOUD_MODE=true on OSS bundle → mismatch', () => {
    const result = detectCloudModeMismatch({ CHM_CLOUD_MODE: 'true' }, false)
    expect(result.mismatch).toBe(true)
  })

  test('cloud bundle + matching runtime cloud → no mismatch', () => {
    const result = detectCloudModeMismatch({ CHM_CLOUD_MODE: 'true' }, true)
    expect(result).toEqual({ server: true, clientBuild: true, mismatch: false })
  })

  test('cloud bundle + runtime unset → no mismatch (fail-closed, both OSS)', () => {
    // Server falls back to build-time (false in tests); a cloud bundle that
    // forgot the runtime var degrades to OSS on BOTH halves — safe, not flagged.
    const result = detectCloudModeMismatch({}, false)
    expect(result).toEqual({
      server: false,
      clientBuild: false,
      mismatch: false,
    })
  })

  test('OSS bundle + no runtime flag → no mismatch', () => {
    const result = detectCloudModeMismatch({}, false)
    expect(result.mismatch).toBe(false)
  })

  test('runtime junk cloud flag on OSS bundle → no mismatch (junk = OSS)', () => {
    const result = detectCloudModeMismatch({ CHM_CLOUD_MODE: 'maybe' }, false)
    expect(result.mismatch).toBe(false)
  })
})
