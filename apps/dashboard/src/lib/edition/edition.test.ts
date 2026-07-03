import {
  type EditionFeature,
  ENTERPRISE_FEATURES,
  getEdition,
  isEnabled,
  parseEdition,
} from './edition'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// parseEdition
// ---------------------------------------------------------------------------
describe('parseEdition', () => {
  test('undefined → community', () => {
    expect(parseEdition(undefined)).toBe('community')
  })

  test('null → community', () => {
    expect(parseEdition(null)).toBe('community')
  })

  test('empty string → community', () => {
    expect(parseEdition('')).toBe('community')
  })

  test('whitespace-only → community', () => {
    expect(parseEdition('   ')).toBe('community')
  })

  test('junk value → community', () => {
    expect(parseEdition('garbage')).toBe('community')
  })

  test('uppercase COMMUNITY → community (not enterprise)', () => {
    expect(parseEdition('COMMUNITY')).toBe('community')
  })

  test("'enterprise' (lowercase) → enterprise", () => {
    expect(parseEdition('enterprise')).toBe('enterprise')
  })

  test("'ENTERPRISE' (uppercase) → enterprise", () => {
    expect(parseEdition('ENTERPRISE')).toBe('enterprise')
  })

  test("' Enterprise ' (mixed-case, padded) → enterprise", () => {
    expect(parseEdition(' Enterprise ')).toBe('enterprise')
  })
})

// ---------------------------------------------------------------------------
// getEdition
// ---------------------------------------------------------------------------
describe('getEdition', () => {
  test('runtime CHM_EDITION=enterprise wins over build-time default', () => {
    expect(getEdition({ CHM_EDITION: 'enterprise' })).toBe('enterprise')
  })

  test('runtime CHM_EDITION=community → community', () => {
    expect(getEdition({ CHM_EDITION: 'community' })).toBe('community')
  })

  test('fail-open: junk CHM_EDITION → community', () => {
    expect(getEdition({ CHM_EDITION: 'garbage' })).toBe('community')
  })

  test('fail-open: empty CHM_EDITION → community', () => {
    expect(getEdition({ CHM_EDITION: '' })).toBe('community')
  })

  test('fail-open: empty env object → community', () => {
    expect(getEdition({})).toBe('community')
  })

  test('no runtimeEnv argument does not throw', () => {
    // Defaults to process.env; CHM_EDITION is not set in the test env
    expect(() => getEdition()).not.toThrow()
    // Must be community when CHM_EDITION is absent from the test process env
    const result = getEdition({ CHM_EDITION: undefined })
    expect(result).toBe('community')
  })
})

// ---------------------------------------------------------------------------
// isEnabled
// ---------------------------------------------------------------------------
describe('isEnabled', () => {
  test('all enterprise features are false in community', () => {
    const communityEnv = { CHM_EDITION: 'community' }
    for (const feature of ENTERPRISE_FEATURES) {
      expect(isEnabled(feature, communityEnv)).toBe(false)
    }
  })

  test('all enterprise features are true in enterprise', () => {
    const enterpriseEnv = { CHM_EDITION: 'enterprise' }
    for (const feature of ENTERPRISE_FEATURES) {
      expect(isEnabled(feature, enterpriseEnv)).toBe(true)
    }
  })

  test('explicit spot-checks per feature in community', () => {
    const env = { CHM_EDITION: 'community' }
    const features: EditionFeature[] = [
      'alerting',
      'sso',
      'rbac',
      'fleet',
      'cloud',
      'audit',
    ]
    for (const f of features) {
      expect(isEnabled(f, env)).toBe(false)
    }
  })

  test('explicit spot-checks per feature in enterprise', () => {
    const env = { CHM_EDITION: 'enterprise' }
    const features: EditionFeature[] = [
      'alerting',
      'sso',
      'rbac',
      'fleet',
      'cloud',
      'audit',
    ]
    for (const f of features) {
      expect(isEnabled(f, env)).toBe(true)
    }
  })
})
