import {
  isBlockedKey,
  looksSensitive,
  redactPingPayload,
  redactProps,
} from './redact'
import { describe, expect, test } from 'bun:test'

describe('isBlockedKey', () => {
  test('blocks sensitive-named keys', () => {
    for (const key of [
      'password',
      'apiKey',
      'api_key',
      'secret',
      'authToken',
      'email',
      'host',
      'hostname',
      'ip',
      'ipAddress',
      'url',
      'endpoint',
      'dsn',
      'sql',
      'query',
      'queryText',
      'license_key',
      'licenseKey',
    ]) {
      expect(isBlockedKey(key)).toBe(true)
    }
  })

  test('allows safe count / enum keys', () => {
    for (const key of [
      'count',
      'n',
      'num_hosts',
      'hosts',
      'ch_flavor',
      'duration_ms',
      'deploy_target',
      'view_count',
      'tooltip',
      'enabled',
    ]) {
      expect(isBlockedKey(key)).toBe(false)
    }
  })
})

describe('looksSensitive', () => {
  test('detects email, IPv4, IPv6, and URL-ish values', () => {
    expect(looksSensitive('me@example.com')).toBe(true)
    expect(looksSensitive('10.0.0.1')).toBe(true)
    expect(looksSensitive('fe80::1')).toBe(true)
    expect(looksSensitive('https://ch.internal:8443')).toBe(true)
    expect(looksSensitive('clickhouse://user:pw@host')).toBe(true)
  })

  test('passes safe enum / count strings', () => {
    expect(looksSensitive('docker')).toBe(false)
    expect(looksSensitive('oss')).toBe(false)
    expect(looksSensitive('24.8')).toBe(false)
    expect(looksSensitive('cloudflare')).toBe(false)
  })
})

describe('redactProps', () => {
  test('drops sensitive keys and values, keeps safe props', () => {
    const out = redactProps({
      deploy_target: 'docker',
      ch_flavor: 'oss',
      num_hosts: 3,
      enabled: true,
      duration_ms: 1200,
      host: 'ch.internal', // blocked key
      email: 'me@example.com', // blocked key
      note: 'reach me@example.com', // sensitive value
      endpoint: 'https://x', // blocked key
      missing: undefined, // dropped (undefined)
    })

    expect(out).toEqual({
      deploy_target: 'docker',
      ch_flavor: 'oss',
      num_hosts: 3,
      enabled: true,
      duration_ms: 1200,
    })
  })

  test('drops license_key from generic track() props', () => {
    const out = redactProps({
      deploy_target: 'docker',
      license_key: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    })
    expect(out).toEqual({ deploy_target: 'docker' })
  })
})

describe('redactPingPayload', () => {
  test('allowlists license_key on the instance ping only', () => {
    const out = redactPingPayload({
      instance_hash: 'a'.repeat(64),
      deploy_target: 'docker',
      license_key: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      host: 'ch.internal',
    })
    expect(out.license_key).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(out.instance_hash).toBe('a'.repeat(64))
    expect(out.deploy_target).toBe('docker')
    expect('host' in out).toBe(false)
  })
})
