import {
  classifyConnectionError,
  extractConnectionErrorMessage,
} from './connection-errors'
import { describe, expect, test } from 'bun:test'

describe('classifyConnectionError', () => {
  test('SSRF / internal address → host_not_allowed', () => {
    const e = classifyConnectionError(
      'Connections to internal addresses are not allowed.'
    )
    expect(e.kind).toBe('host_not_allowed')
    expect(e.docsSlug).toBe('guides/connection-errors')
  })

  test('invalid URL → invalid_url', () => {
    const e = classifyConnectionError(
      'Invalid host URL: "host". Must be a full URL (e.g., https://my.clickhouse.cloud:8443)'
    )
    expect(e.kind).toBe('invalid_url')
  })

  test('ClickHouse auth code 516 → auth_failed', () => {
    const e = classifyConnectionError('Code: 516. Authentication failed')
    expect(e.kind).toBe('auth_failed')
  })

  test('not enough privileges → access_denied', () => {
    const e = classifyConnectionError(
      'Code: 497. DB::Exception: monitoring: Not enough privileges'
    )
    expect(e.kind).toBe('access_denied')
  })

  test('DNS failure → dns_error', () => {
    const e = classifyConnectionError('getaddrinfo ENOTFOUND nope.example')
    expect(e.kind).toBe('dns_error')
  })

  test('refused → connection_refused', () => {
    const e = classifyConnectionError('connect ECONNREFUSED 1.2.3.4:8443')
    expect(e.kind).toBe('connection_refused')
  })

  test('TLS → tls_error', () => {
    const e = classifyConnectionError('self signed certificate in chain')
    expect(e.kind).toBe('tls_error')
  })

  test('timeout → timeout', () => {
    const e = classifyConnectionError('connect ETIMEDOUT')
    expect(e.kind).toBe('timeout')
  })

  test('unknown string → unknown with raw preserved', () => {
    const e = classifyConnectionError('some weird error')
    expect(e.kind).toBe('unknown')
    expect(e.raw).toBe('some weird error')
  })

  test('empty / null → unknown, never throws', () => {
    expect(classifyConnectionError('').kind).toBe('unknown')
    expect(classifyConnectionError(null).kind).toBe('unknown')
    expect(classifyConnectionError(undefined).kind).toBe('unknown')
  })

  test('every classification carries a docs slug', () => {
    const e = classifyConnectionError('anything')
    expect(e.docsSlug.length).toBeGreaterThan(0)
  })
})

describe('extractConnectionErrorMessage', () => {
  test('test-endpoint shape { error: string }', () => {
    expect(extractConnectionErrorMessage({ ok: false, error: 'boom' })).toBe(
      'boom'
    )
  })

  test('validation shape { error: { message } }', () => {
    expect(
      extractConnectionErrorMessage({
        success: false,
        error: { type: 'validation_error', message: 'bad url' },
      })
    ).toBe('bad url')
  })

  test('unrecognised → fallback string', () => {
    expect(extractConnectionErrorMessage({})).toBe('Connection failed')
    expect(extractConnectionErrorMessage(null)).toBe('Connection failed')
  })
})

describe('classifyConnectionError — Postgres (SQLSTATE-appended) rules', () => {
  test('28P01 invalid_password → auth_failed', () => {
    const e = classifyConnectionError(
      'password authentication failed for user "postgres" [28P01]'
    )
    expect(e.kind).toBe('auth_failed')
  })

  test('3D000 invalid_catalog_name → database_not_found', () => {
    const e = classifyConnectionError('database "nope" does not exist [3D000]')
    expect(e.kind).toBe('database_not_found')
  })

  test('08006 connection failure → connection_refused', () => {
    const e = classifyConnectionError('connection to server failed [08006]')
    expect(e.kind).toBe('connection_refused')
  })

  test('ECONNREFUSED → connection_refused', () => {
    const e = classifyConnectionError('connect ECONNREFUSED 1.2.3.4:5432')
    expect(e.kind).toBe('connection_refused')
  })

  test('server without TLS → tls_error', () => {
    const e = classifyConnectionError(
      'The server does not support SSL connections'
    )
    expect(e.kind).toBe('tls_error')
  })

  test('connect timeout → timeout', () => {
    const e = classifyConnectionError('Connection timeout expired')
    expect(e.kind).toBe('timeout')
  })

  test('ENOTFOUND → dns_error', () => {
    const e = classifyConnectionError('getaddrinfo ENOTFOUND db.internal')
    expect(e.kind).toBe('dns_error')
  })
})
