import { apiKeyAuthEnabled, issueApiKey, verifyApiKey } from '../auth/api-key'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const ORIGINAL_SECRET = process.env.CHM_API_KEY_SECRET

function setSecret(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>)
      .CHM_API_KEY_SECRET
  } else {
    Object.assign(process.env, { CHM_API_KEY_SECRET: value })
  }
}

afterEach(() => setSecret(ORIGINAL_SECRET))

describe('apiKeyAuthEnabled', () => {
  it('reports disabled when the secret is unset', () => {
    setSecret(undefined)
    expect(apiKeyAuthEnabled()).toBe(false)
  })

  it('reports enabled when the secret is configured', () => {
    setSecret('s3cret')
    expect(apiKeyAuthEnabled()).toBe(true)
  })
})

describe('issueApiKey + verifyApiKey round trip', () => {
  beforeEach(() => setSecret('test-secret'))

  it('issues a chm_ prefixed token that verifyApiKey accepts', async () => {
    const token = await issueApiKey('user-1', 1)

    expect(token.startsWith('chm_')).toBe(true)
    const result = await verifyApiKey(token)
    expect(result.valid).toBe(true)
    expect(result.sub).toBe('user-1')
  })

  it('rejects a token signed under a different secret', async () => {
    const token = await issueApiKey('user-1', 1)
    setSecret('different-secret')

    const result = await verifyApiKey(token)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('bad signature')
  })

  it('rejects tokens missing the chm_ prefix', async () => {
    const result = await verifyApiKey('not-a-chm-token.payload.sig')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid prefix')
  })

  it('rejects tokens missing the . separator', async () => {
    const result = await verifyApiKey('chm_onlypayload')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('malformed token')
  })

  it('throws when issuing without a configured secret', () => {
    setSecret(undefined)
    expect(issueApiKey('user-1')).rejects.toThrow(/not configured/)
  })

  it('returns disabled when CHM_API_KEY_SECRET is unset', async () => {
    setSecret(undefined)
    const result = await verifyApiKey('anything')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('disabled')
  })
})
