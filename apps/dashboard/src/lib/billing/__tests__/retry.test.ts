import {
  billingErrorStatus,
  isBillingAuthError,
  retryBillingUnlessAuthError,
} from '../retry'
import { describe, expect, test } from 'bun:test'

describe('billingErrorStatus', () => {
  test('reads a numeric status property', () => {
    expect(billingErrorStatus({ status: 401 })).toBe(401)
  })

  test('parses a status embedded in the message', () => {
    expect(billingErrorStatus(new Error('Request failed (403)'))).toBe(403)
  })

  test('returns null when no status is present', () => {
    expect(billingErrorStatus(new Error('boom'))).toBeNull()
    expect(billingErrorStatus(null)).toBeNull()
    expect(billingErrorStatus('nope')).toBeNull()
  })
})

describe('isBillingAuthError', () => {
  test('true for 401/403', () => {
    expect(isBillingAuthError({ status: 401 })).toBe(true)
    expect(isBillingAuthError({ status: 403 })).toBe(true)
    expect(isBillingAuthError(new Error('Usage request failed (401)'))).toBe(
      true
    )
  })

  test('false for other statuses / no status', () => {
    expect(isBillingAuthError({ status: 500 })).toBe(false)
    expect(isBillingAuthError(new Error('network error'))).toBe(false)
  })
})

describe('retryBillingUnlessAuthError', () => {
  test('never retries a deterministic auth failure (the OSS 401 spam case)', () => {
    const err = { status: 401 }
    expect(retryBillingUnlessAuthError(0, err)).toBe(false)
    expect(retryBillingUnlessAuthError(3, err)).toBe(false)
  })

  test('retries a transient failure up to 5 times', () => {
    const err = new Error('network error')
    expect(retryBillingUnlessAuthError(0, err)).toBe(true)
    expect(retryBillingUnlessAuthError(4, err)).toBe(true)
    expect(retryBillingUnlessAuthError(5, err)).toBe(false)
  })
})
