import {
  applyCloudHostDefaults,
  CLOUD_DEFAULT_PORT,
} from './connection-presets'
import { describe, expect, test } from 'bun:test'

describe('applyCloudHostDefaults — ClickHouse Cloud preset host normalization', () => {
  test('wraps a bare hostname into https on the Cloud port (8443)', () => {
    expect(
      applyCloudHostDefaults('abc123.us-east-1.aws.clickhouse.cloud')
    ).toBe(
      `https://abc123.us-east-1.aws.clickhouse.cloud:${CLOUD_DEFAULT_PORT}`
    )
  })

  test('respects an explicit bare-host port instead of forcing 8443', () => {
    expect(applyCloudHostDefaults('my.clickhouse.cloud:9440')).toBe(
      'https://my.clickhouse.cloud:9440'
    )
  })

  test('fills in the missing port on an https URL', () => {
    expect(applyCloudHostDefaults('https://my.clickhouse.cloud')).toBe(
      `https://my.clickhouse.cloud:${CLOUD_DEFAULT_PORT}`
    )
  })

  test('leaves a full https URL with an explicit port untouched', () => {
    expect(applyCloudHostDefaults('https://my.clickhouse.cloud:9440')).toBe(
      'https://my.clickhouse.cloud:9440'
    )
  })

  test('never silently rewrites an explicit http:// choice to https', () => {
    // Cloud requires TLS, but an explicit protocol choice is respected — the
    // Cloud-specific error hint (not a magic rewrite) guides the user here.
    expect(applyCloudHostDefaults('http://my.clickhouse.cloud:8123')).toBe(
      'http://my.clickhouse.cloud:8123'
    )
  })

  test('never fabricates a host from empty input', () => {
    expect(applyCloudHostDefaults('')).toBe('')
    expect(applyCloudHostDefaults('   ')).toBe('')
  })

  test('leaves an unparseable value untouched rather than throwing', () => {
    expect(applyCloudHostDefaults('https://')).toBe('https://')
  })
})
