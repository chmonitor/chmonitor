import {
  getLicenseKey,
  LICENSE_KEY_MAX_LEN,
  sanitizeLicenseKey,
} from './license-key'
import { describe, expect, test } from 'bun:test'

/** Polar checkout ids are UUIDs — this is the identifier operators set. */
const POLAR_CHECKOUT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

describe('sanitizeLicenseKey', () => {
  test('accepts a Polar checkout UUID', () => {
    expect(sanitizeLicenseKey(POLAR_CHECKOUT_ID)).toBe(POLAR_CHECKOUT_ID)
  })

  test('trims surrounding whitespace', () => {
    expect(sanitizeLicenseKey(`  ${POLAR_CHECKOUT_ID}  `)).toBe(
      POLAR_CHECKOUT_ID
    )
  })

  test('omits unset / empty / short values', () => {
    expect(sanitizeLicenseKey(undefined)).toBeUndefined()
    expect(sanitizeLicenseKey(null)).toBeUndefined()
    expect(sanitizeLicenseKey('')).toBeUndefined()
    expect(sanitizeLicenseKey('   ')).toBeUndefined()
    expect(sanitizeLicenseKey('abc')).toBeUndefined()
  })

  test('rejects emails, URLs, and spaces (lookup emails are not the key)', () => {
    expect(sanitizeLicenseKey('billing@example.com')).toBeUndefined()
    expect(sanitizeLicenseKey('https://polar.sh/checkout/abc')).toBeUndefined()
    expect(sanitizeLicenseKey('not a key')).toBeUndefined()
  })

  test('rejects values longer than the cap', () => {
    expect(
      sanitizeLicenseKey(`${'a'.repeat(LICENSE_KEY_MAX_LEN + 1)}`)
    ).toBeUndefined()
  })
})

describe('getLicenseKey', () => {
  test('reads CHM_LICENSE_KEY from the runtime env map', () => {
    expect(getLicenseKey({ CHM_LICENSE_KEY: POLAR_CHECKOUT_ID })).toBe(
      POLAR_CHECKOUT_ID
    )
  })

  test('omits when unset', () => {
    expect(getLicenseKey({})).toBeUndefined()
    expect(getLicenseKey({ CHM_LICENSE_KEY: '' })).toBeUndefined()
    expect(getLicenseKey({ UNRELATED: POLAR_CHECKOUT_ID })).toBeUndefined()
  })
})
