import { describe, expect, test } from 'bun:test'
import { SECURITY_HEADERS, withSecurityHeaders } from '@/lib/security-headers'

describe('SECURITY_HEADERS', () => {
  test('contains all expected headers', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY')
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin'
    )
    expect(SECURITY_HEADERS['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
  })

  test('ships CSP in report-only mode (never enforced)', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy-Report-Only']
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    // Enforcing CSP must NOT be set — report-only only, pending validation.
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBeUndefined()
  })

  test('has exactly 5 entries (no accidental additions)', () => {
    expect(Object.keys(SECURITY_HEADERS)).toHaveLength(5)
  })
})

describe('withSecurityHeaders', () => {
  test('adds security headers to a plain response', () => {
    const original = new Response('ok', { status: 200 })
    const result = withSecurityHeaders(original)

    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(result.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    )
    expect(result.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
  })

  test('preserves original status, statusText, and body', async () => {
    const original = new Response('hello', {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'text/plain' },
    })
    const result = withSecurityHeaders(original)

    expect(result.status).toBe(201)
    expect(result.statusText).toBe('Created')
    expect(await result.text()).toBe('hello')
  })

  test('preserves existing non-security headers', () => {
    const original = new Response('ok', {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom': 'value',
      },
    })
    const result = withSecurityHeaders(original)

    expect(result.headers.get('Content-Type')).toBe('application/json')
    expect(result.headers.get('X-Custom')).toBe('value')
  })

  test('overwrites pre-existing security header values', () => {
    const original = new Response('ok', {
      headers: { 'X-Frame-Options': 'SAMEORIGIN' },
    })
    const result = withSecurityHeaders(original)

    expect(result.headers.get('X-Frame-Options')).toBe('DENY')
  })

  test('does not mutate the original response', () => {
    const original = new Response('ok', {
      headers: { 'X-Frame-Options': 'SAMEORIGIN' },
    })
    withSecurityHeaders(original)

    expect(original.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })
})
