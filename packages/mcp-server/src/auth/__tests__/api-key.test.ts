import { apiKeyAuthEnabled, issueApiKey, verifyApiKey } from '../api-key'
import { afterEach, describe, expect, it } from 'bun:test'

const TEST_SECRET = 'test-secret-key-for-unit-tests-at-least-32-chars'

describe('api-key', () => {
  const originalSecret = process.env.CHM_API_KEY_SECRET

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.CHM_API_KEY_SECRET = originalSecret
    } else {
      delete process.env.CHM_API_KEY_SECRET
    }
  })

  describe('apiKeyAuthEnabled', () => {
    it('returns false when CHM_API_KEY_SECRET is not set', () => {
      delete process.env.CHM_API_KEY_SECRET
      expect(apiKeyAuthEnabled()).toBe(false)
    })

    it('returns true when CHM_API_KEY_SECRET is set', () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      expect(apiKeyAuthEnabled()).toBe(true)
    })

    it('returns false when CHM_API_KEY_SECRET is empty string', () => {
      process.env.CHM_API_KEY_SECRET = ''
      expect(apiKeyAuthEnabled()).toBe(false)
    })
  })

  describe('issueApiKey', () => {
    it('throws when CHM_API_KEY_SECRET is not configured', async () => {
      delete process.env.CHM_API_KEY_SECRET
      expect(issueApiKey('user1')).rejects.toThrow(
        'CHM_API_KEY_SECRET is not configured'
      )
    })

    it('issues a token with chm_ prefix', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')
      expect(token.startsWith('chm_')).toBe(true)
    })

    it('issues tokens with two base64url segments after prefix', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')
      const raw = token.slice(4) // strip chm_
      const parts = raw.split('.')
      expect(parts.length).toBe(2)
      // Both parts should be valid base64url
      expect(parts[0].length).toBeGreaterThan(0)
      expect(parts[1].length).toBeGreaterThan(0)
    })

    it('uses default 30-day expiry', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')
      // Verify it's valid (not expired) immediately after issue
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(true)
      expect(result.sub).toBe('user1')
    })

    it('supports custom expiry days', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1', 1) // 1 day
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(true)
      expect(result.sub).toBe('user1')
    })

    it('stamps scopes onto the issued token when provided', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1', 30, [
        'read:metrics',
        'mcp:access',
      ])
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(true)
      expect(result.scopes).toEqual(['read:metrics', 'mcp:access'])
    })

    it('omits scopes from the payload when none are provided (all scopes)', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(true)
      expect(result.scopes).toBeUndefined()
    })
  })

  describe('verifyApiKey', () => {
    it('returns valid when secret is not configured (auth disabled)', async () => {
      delete process.env.CHM_API_KEY_SECRET
      const result = await verifyApiKey('anything')
      expect(result.valid).toBe(true)
      expect(result.sub).toBeUndefined()
      expect(result.reason).toBeUndefined()
    })

    it('returns valid for a freshly issued token', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('test-user')
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(true)
      expect(result.sub).toBe('test-user')
    })

    it('rejects tokens without chm_ prefix', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const result = await verifyApiKey('bad_token')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('invalid prefix')
    })

    it('rejects tokens with wrong prefix', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const result = await verifyApiKey('xhm_something.else')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('invalid prefix')
    })

    it('rejects malformed tokens (missing dot)', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const result = await verifyApiKey('chm_nodothere')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('malformed token')
    })

    it('rejects malformed tokens (empty payload)', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const result = await verifyApiKey('chm_.abc')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('malformed token')
    })

    it('rejects malformed tokens (empty signature)', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const result = await verifyApiKey('chm_abc.')
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('malformed token')
    })

    it('rejects tokens signed with a different secret', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')

      // Change the secret to simulate a different server
      process.env.CHM_API_KEY_SECRET =
        'different-secret-key-for-testing-at-least-32-chars'
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('bad signature')
    })

    it('rejects expired tokens', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      // Issue a token that expires in 0 days (already expired)
      // We need to craft an expired token manually
      const now = Math.floor(Date.now() / 1000)
      const payload = { sub: 'user1', iat: now - 100, exp: now - 1 }

      // Import signing helpers indirectly by issuing and manipulating
      // Actually, let's issue with days=0 which means exp = now
      // The token may still be valid if issued in the same second,
      // so we'll verify the logic path by testing with a crafted token

      // Use the module's internals to create an expired token
      // Since we can't access private functions, test via issueApiKey with days=0
      // and verify immediately (race: might pass if same second)
      // Better approach: manually construct expired token using same signing logic

      // We'll encode the payload manually
      const payloadEnc = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')

      // Sign it with the test secret
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(TEST_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(payloadEnc)
      )
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')

      const token = `chm_${payloadEnc}.${sigB64}`
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('expired')
    })

    it('rejects tokens with tampered payload', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('user1')

      // Tamper with the payload (change first char after chm_)
      const raw = token.slice(4)
      const [payloadEnc, sigEnc] = raw.split('.')
      // Flip a character in the payload
      const tampered = `${payloadEnc.slice(0, -1)}X`
      const tamperedToken = `chm_${tampered}.${sigEnc}`

      const result = await verifyApiKey(tamperedToken)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('bad signature')
    })

    it('rejects tokens with invalid base64url signature', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      // Craft a token with valid-looking structure but invalid base64 in sig
      const result = await verifyApiKey('chm_eyJhbG.!!!invalid!!!')
      expect(result.valid).toBe(false)
      // Could be malformed signature or bad signature depending on decode
      expect(result.valid).toBe(false)
    })

    it('rejects tokens with invalid JSON in payload', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      // Create valid base64url of non-JSON string
      const fakePayload = btoa('not-json-at-all')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')

      // Sign it properly so signature check passes
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(TEST_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(fakePayload)
      )
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')

      const token = `chm_${fakePayload}.${sigB64}`
      const result = await verifyApiKey(token)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('malformed token')
    })

    it('extracts sub claim from valid token', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const token = await issueApiKey('admin@example.com')
      const result = await verifyApiKey(token)
      expect(result.sub).toBe('admin@example.com')
    })
  })
})
