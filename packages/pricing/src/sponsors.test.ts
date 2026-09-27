import { isSponsorEmailAcceptable } from './sponsors'
import { describe, expect, test } from 'bun:test'

describe('isSponsorEmailAcceptable', () => {
  test('accepts a normal, deliverable-looking address', () => {
    for (const email of [
      'ops@acme.com',
      'hello@chmonitor.dev',
      'first.last+tag@sub.acme.co.uk',
      '  ops@acme.com  ',
    ]) {
      expect(isSponsorEmailAcceptable(email), email).toBe(true)
    }
  })

  test('rejects malformed addresses', () => {
    for (const email of [
      '',
      'nope',
      'a@b',
      'a b@acme.com',
      'a@acme com',
      '@acme.com',
    ]) {
      expect(isSponsorEmailAcceptable(email), email).toBe(false)
    }
  })

  test('rejects placeholder domains — Polar 422s these', () => {
    // Found in production: Polar refuses to attach a customer to a reserved
    // domain and rejects the checkout, so the form must stop it earlier.
    for (const email of [
      'you@example.com',
      'you@example.org',
      'you@example.net',
      'you@probe.example',
      'a@acme.invalid',
      'a@localhost',
      'a@acme.test',
      'YOU@EXAMPLE.COM',
    ]) {
      expect(isSponsorEmailAcceptable(email), email).toBe(false)
    }
  })

  test('a real domain that merely contains a reserved word is fine', () => {
    expect(isSponsorEmailAcceptable('ops@example.io')).toBe(true)
    expect(isSponsorEmailAcceptable('ops@testing.acme.com')).toBe(true)
  })
})
