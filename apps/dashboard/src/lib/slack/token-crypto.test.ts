/**
 * Tests for at-rest Slack bot-token encryption (plans/37).
 *
 * Proves the AES-256-GCM envelope round-trips, that ciphertext is not the
 * plaintext (token is not stored in the clear), and that decryption fails when
 * the key material (signing secret) differs — the property that makes a rotated
 * secret invalidate stored tokens rather than silently leaking them.
 */

import { afterEach, describe, expect, test } from 'bun:test'

const ORIGINAL = process.env.SLACK_SIGNING_SECRET
const ORIGINAL_KEY = process.env.SLACK_TOKEN_ENCRYPTION_KEY

afterEach(() => {
  // Restore env so tests stay isolated (config reads process.env live).
  if (ORIGINAL === undefined) delete process.env.SLACK_SIGNING_SECRET
  else process.env.SLACK_SIGNING_SECRET = ORIGINAL
  if (ORIGINAL_KEY === undefined) delete process.env.SLACK_TOKEN_ENCRYPTION_KEY
  else process.env.SLACK_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY
})

describe('token-crypto', () => {
  test('round-trips a token and does not store it in the clear', async () => {
    delete process.env.SLACK_TOKEN_ENCRYPTION_KEY
    process.env.SLACK_SIGNING_SECRET = 'signing-secret-a'
    const { encryptToken, decryptToken, isTokenEncryptionConfigured } =
      await import('./token-crypto')

    expect(isTokenEncryptionConfigured()).toBe(true)
    // A structurally-obvious fake: real bot tokens are `xoxb-…`, but we avoid
    // that exact shape so secret scanners don't flag this fixture. The crypto
    // treats the token as an opaque string, so any value exercises the envelope.
    const token = 'slack-bot-token-example-value-for-tests'
    const enc = await encryptToken(token)
    expect(enc).not.toContain(token)
    expect(enc).not.toBe(token)
    expect(await decryptToken(enc)).toBe(token)
  })

  test('a token encrypted under a different signing secret does not decrypt', async () => {
    delete process.env.SLACK_TOKEN_ENCRYPTION_KEY
    process.env.SLACK_SIGNING_SECRET = 'signing-secret-a'
    const cryptoA = await import('./token-crypto')
    const enc = await cryptoA.encryptToken('xoxb-secret')

    // Rotate the secret; the same module now derives a different key.
    process.env.SLACK_SIGNING_SECRET = 'signing-secret-b'
    await expect(cryptoA.decryptToken(enc)).rejects.toThrow()
  })

  test('encryption is unavailable when no key material is present', async () => {
    delete process.env.SLACK_TOKEN_ENCRYPTION_KEY
    delete process.env.SLACK_SIGNING_SECRET
    const { isTokenEncryptionConfigured, encryptToken } = await import(
      './token-crypto'
    )
    expect(isTokenEncryptionConfigured()).toBe(false)
    await expect(encryptToken('xoxb-secret')).rejects.toThrow()
  })
})
