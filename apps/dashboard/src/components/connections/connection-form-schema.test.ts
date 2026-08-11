import type { ConnectionFormData } from './connection-form-schema'

import { isFormValid, isValidUrl } from './connection-form-schema'
import { describe, expect, test } from 'bun:test'

function baseForm(
  overrides: Partial<ConnectionFormData> = {}
): ConnectionFormData {
  return {
    name: 'My cluster',
    host: 'https://localhost:8123',
    user: 'default',
    password: '',
    engine: 'clickhouse',
    ...overrides,
  }
}

describe('isValidUrl', () => {
  test('accepts http and https URLs', () => {
    expect(isValidUrl('http://localhost:8123')).toBe(true)
    expect(isValidUrl('https://play.clickhouse.com')).toBe(true)
  })

  test('rejects a bare hostname with no scheme', () => {
    expect(isValidUrl('localhost')).toBe(false)
  })

  test('rejects a non-http(s) scheme', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false)
  })

  test('rejects an empty string', () => {
    expect(isValidUrl('')).toBe(false)
  })
})

describe('isFormValid — ClickHouse branch', () => {
  test('valid when name, user, and a valid URL host are present', () => {
    expect(isFormValid(baseForm(), false)).toBe(true)
  })

  test('invalid with a non-URL host', () => {
    expect(isFormValid(baseForm({ host: 'localhost' }), false)).toBe(false)
  })

  test('invalid with a missing required field (name)', () => {
    expect(isFormValid(baseForm({ name: '  ' }), false)).toBe(false)
  })
})

describe('isFormValid — Postgres branch', () => {
  function postgresForm(overrides: Partial<ConnectionFormData> = {}) {
    return baseForm({
      host: 'db.example.com',
      database: 'postgres',
      engine: 'postgres',
      ...overrides,
    })
  }

  test('valid when name, user, bare host, and database are present', () => {
    expect(isFormValid(postgresForm(), true)).toBe(true)
  })

  test('invalid with an empty host (bare hostname required, not a URL)', () => {
    expect(isFormValid(postgresForm({ host: '' }), true)).toBe(false)
  })

  test('does not require a URL-shaped host (unlike the ClickHouse branch)', () => {
    // A bare hostname would fail isValidUrl, but Postgres never checks it.
    expect(isValidUrl('db.example.com')).toBe(false)
    expect(isFormValid(postgresForm({ host: 'db.example.com' }), true)).toBe(
      true
    )
  })

  test('invalid with a missing required field (database)', () => {
    expect(isFormValid(postgresForm({ database: '' }), true)).toBe(false)
  })
})
