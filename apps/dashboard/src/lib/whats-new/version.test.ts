import {
  compareVersions,
  hasUnseenChangelog,
  hasUnseenUpgrade,
  isProductVersionTag,
  isVersionNewer,
  normalizeVersion,
  parseLastSeenChangelogVersion,
  parseSemver,
  toProductTag,
} from './version'
import { describe, expect, test } from 'bun:test'

describe('isProductVersionTag', () => {
  test('accepts vX.Y.Z only', () => {
    expect(isProductVersionTag('v0.3.3')).toBe(true)
    expect(isProductVersionTag('v1.0.0')).toBe(true)
  })

  test('skips CLI and Helm tags', () => {
    expect(isProductVersionTag('chm-v0.1.0')).toBe(false)
    expect(isProductVersionTag('chm-0.1.0')).toBe(false)
    expect(isProductVersionTag('helm-chmonitor-0.2.0')).toBe(false)
  })

  test('skips unprefixed or extra-suffix tags', () => {
    expect(isProductVersionTag('0.3.3')).toBe(false)
    expect(isProductVersionTag('v0.3.3-rc.1')).toBe(false)
    expect(isProductVersionTag('v0.3')).toBe(false)
  })
})

describe('compareVersions', () => {
  test('orders semver triples', () => {
    expect(compareVersions('0.3.3', '0.3.2')).toBeGreaterThan(0)
    expect(compareVersions('v0.3.2', '0.3.3')).toBeLessThan(0)
    expect(compareVersions('v0.3.3', '0.3.3')).toBe(0)
    expect(compareVersions('0.4.0', '0.3.9')).toBeGreaterThan(0)
  })

  test('treats unparseable as older', () => {
    expect(compareVersions('nope', '0.1.0')).toBeLessThan(0)
    expect(isVersionNewer('0.3.3', '0.3.2')).toBe(true)
    expect(isVersionNewer('0.3.2', '0.3.3')).toBe(false)
  })

  test('normalizeVersion strips the v prefix', () => {
    expect(normalizeVersion('v0.3.3')).toBe('0.3.3')
    expect(toProductTag('0.3.3')).toBe('v0.3.3')
    expect(parseSemver('v0.3.3')).toEqual([0, 3, 3])
  })
})

describe('last-seen persist helpers', () => {
  test('empty last-seen is unseen but not an upgrade', () => {
    expect(hasUnseenChangelog('0.3.3', '')).toBe(true)
    expect(hasUnseenChangelog('0.3.3', undefined)).toBe(true)
    expect(hasUnseenUpgrade('0.3.3', '')).toBe(false)
  })

  test('older last-seen is both unseen and an upgrade', () => {
    expect(hasUnseenChangelog('0.3.3', '0.3.2')).toBe(true)
    expect(hasUnseenUpgrade('0.3.3', '0.3.2')).toBe(true)
  })

  test('current last-seen clears unseen', () => {
    expect(hasUnseenChangelog('0.3.3', '0.3.3')).toBe(false)
    expect(hasUnseenUpgrade('0.3.3', 'v0.3.3')).toBe(false)
  })

  test('parseLastSeenChangelogVersion keeps valid versions only', () => {
    expect(parseLastSeenChangelogVersion('v0.3.2')).toBe('0.3.2')
    expect(parseLastSeenChangelogVersion('junk')).toBe('')
    expect(parseLastSeenChangelogVersion(12)).toBe('')
  })
})
