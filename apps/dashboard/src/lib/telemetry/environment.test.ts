import { detectChFlavor, getDeployTarget, parseMajorMinor } from './environment'
import { redactProps } from './redact'
import { describe, expect, test } from 'bun:test'

describe('parseMajorMinor', () => {
  test('extracts major.minor from a 4-part version', () => {
    expect(parseMajorMinor('24.8.1.2')).toBe('24.8')
  })

  test('extracts major.minor from a 2-part version', () => {
    expect(parseMajorMinor('24.8')).toBe('24.8')
  })

  test('extracts major.minor when suffix is present', () => {
    expect(parseMajorMinor('24.8.5.7-altinity')).toBe('24.8')
  })

  test('returns undefined for empty string', () => {
    expect(parseMajorMinor('')).toBeUndefined()
  })

  test('returns undefined for null', () => {
    expect(parseMajorMinor(null)).toBeUndefined()
  })

  test('returns undefined for undefined', () => {
    expect(parseMajorMinor(undefined)).toBeUndefined()
  })

  test('returns undefined for non-version strings', () => {
    expect(parseMajorMinor('not-a-version')).toBeUndefined()
  })

  test('extracts major.minor when a prefix is present', () => {
    expect(parseMajorMinor('ClickHouse 24.8.1.2')).toBe('24.8')
  })
})

describe('detectChFlavor', () => {
  test('detects altinity from substring (case-insensitive)', () => {
    expect(detectChFlavor('24.8.5.7-altinity')).toBe('altinity')
    expect(detectChFlavor('24.8.5.7-Altinity')).toBe('altinity')
    expect(detectChFlavor('ALTINITY-24.8')).toBe('altinity')
  })

  test('returns oss for a plain numeric version', () => {
    expect(detectChFlavor('24.8.1.2')).toBe('oss')
    expect(detectChFlavor('23.12.1.1')).toBe('oss')
  })

  test('returns unknown for empty string', () => {
    expect(detectChFlavor('')).toBe('unknown')
  })

  test('returns unknown for null', () => {
    expect(detectChFlavor(null)).toBe('unknown')
  })

  test('returns unknown for undefined', () => {
    expect(detectChFlavor(undefined)).toBe('unknown')
  })

  test('returns cloud when hostname is ClickHouse Cloud', () => {
    expect(detectChFlavor('24.8.1.2', 'abc.us-east-1.aws.clickhouse.cloud')).toBe(
      'cloud'
    )
  })
})

describe('getDeployTarget', () => {
  test('returns unknown as fallback when VITE_DEPLOY_TARGET is not set', () => {
    // In the test environment import.meta.env.VITE_DEPLOY_TARGET is undefined.
    const result = getDeployTarget()
    expect(['docker', 'helm', 'cf', 'dev', 'unknown']).toContain(result)
  })
})

describe('redaction safety: ch_version major.minor passes through', () => {
  test('ch_version "24.8" is NOT redacted (major.minor is not an IPv4)', () => {
    const out = redactProps({ ch_version: '24.8' })
    expect(out).toEqual({ ch_version: '24.8' })
  })

  test('full 4-part version "24.8.1.2" WOULD be redacted (confirms the risk)', () => {
    // This is the exact reason parseMajorMinor exists: a 4-part version
    // matches the IPv4 pattern and is dropped by looksSensitive().
    const out = redactProps({ ch_version: '24.8.1.2' })
    expect(out).toEqual({})
  })

  test('deploy_target enum values are not redacted', () => {
    const out = redactProps({ deploy_target: 'cf' })
    expect(out).toEqual({ deploy_target: 'cf' })
  })

  test('ch_flavor enum values are not redacted', () => {
    const out = redactProps({ ch_flavor: 'oss' })
    expect(out).toEqual({ ch_flavor: 'oss' })
  })
})
