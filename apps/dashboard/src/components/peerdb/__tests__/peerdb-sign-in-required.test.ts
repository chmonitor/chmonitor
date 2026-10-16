import { isPeerDBNotConfigured, isPeerDBSignInRequired } from '../peerdb-utils'
import { describe, expect, test } from 'bun:test'

describe('PeerDB error classification', () => {
  test('401 means sign-in required, not not-configured', () => {
    expect(isPeerDBSignInRequired({ status: 401 })).toBe(true)
    expect(isPeerDBNotConfigured({ status: 401 })).toBe(false)
  })

  test('503 stays not-configured and is not a sign-in prompt', () => {
    expect(isPeerDBNotConfigured({ status: 503 })).toBe(true)
    expect(isPeerDBSignInRequired({ status: 503 })).toBe(false)
  })

  test('other errors and undefined are neither', () => {
    expect(isPeerDBSignInRequired({ status: 500 })).toBe(false)
    expect(isPeerDBSignInRequired(undefined)).toBe(false)
  })
})
