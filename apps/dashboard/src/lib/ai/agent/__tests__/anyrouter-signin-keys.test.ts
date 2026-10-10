/**
 * Server half of "Sign in with AnyRouter":
 * - `selectAgentApiKey`: request key → stored user token → deployment key,
 *   and a store outage never blocks the agent.
 * - `resolveProvider`: a user key replaces the deployment AnyRouter key (a
 *   guest must not run on the deployment key while skipping the daily cap).
 * - `classifyError`: an AnyRouter 401 on a user token is `anyrouter_token_expired`.
 * - the flag parser fails closed.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { APICallError } from 'ai'
import { selectAgentApiKey } from '@/lib/ai/agent/byok'
import {
  ANYROUTER_TOKEN_EXPIRED_CODE,
  classifyError,
} from '@/lib/ai/agent/errors'
import {
  isAnyRouterProviderModel,
  parseAnyRouterSigninEnabled,
} from '@/lib/ai/anyrouter-signin-flag'
import { resolveProvider } from '@/lib/ai/providers'

const base = {
  requestApiKey: null as string | null,
  signedIn: true,
  anyrouterSigninEnabled: true,
  anyrouterModel: true,
}

describe('selectAgentApiKey', () => {
  test('request key wins and the store is not read', async () => {
    const load = mock(async () => 'stored-token-123456')
    const result = await selectAgentApiKey({
      ...base,
      requestApiKey: 'request-key-123456',
      loadStoredToken: load,
    })
    expect(result).toEqual({ apiKey: 'request-key-123456', source: 'request' })
    expect(load).not.toHaveBeenCalled()
  })

  test('signed-in, no request key → stored token', async () => {
    const result = await selectAgentApiKey({
      ...base,
      loadStoredToken: async () => 'stored-token-123456',
    })
    expect(result).toEqual({ apiKey: 'stored-token-123456', source: 'stored' })
  })

  test('stored token is skipped for guests, flag off, or a non-AnyRouter model', async () => {
    for (const override of [
      { signedIn: false },
      { anyrouterSigninEnabled: false },
      { anyrouterModel: false },
    ]) {
      const load = mock(async () => 'stored-token-123456')
      const result = await selectAgentApiKey({
        ...base,
        ...override,
        loadStoredToken: load,
      })
      expect(result).toEqual({ apiKey: null, source: 'deployment' })
      expect(load).not.toHaveBeenCalled()
    }
  })

  test('no stored token, or the store throws → deployment key', async () => {
    expect(
      await selectAgentApiKey({ ...base, loadStoredToken: async () => null })
    ).toEqual({ apiKey: null, source: 'deployment' })
    expect(
      await selectAgentApiKey({
        ...base,
        loadStoredToken: async () => {
          throw new Error('D1 down')
        },
      })
    ).toEqual({ apiKey: null, source: 'deployment' })
  })
})

describe('resolveProvider with a user AnyRouter key', () => {
  const saved = process.env.ANYROUTER_API_KEY
  afterEach(() => {
    if (saved === undefined) delete process.env.ANYROUTER_API_KEY
    else process.env.ANYROUTER_API_KEY = saved
  })

  test('the user key replaces the deployment key', () => {
    process.env.ANYROUTER_API_KEY = 'deployment-key-000000'
    expect(
      resolveProvider('anyrouter:openai/gpt-5', 'user-token-123456').apiKey
    ).toBe('user-token-123456')
  })
})

describe('classifyError — anyrouter_token_expired', () => {
  const upstream401 = { statusCode: 401, message: 'Unauthorized' }

  test('AnyRouter 401 on a user token → code anyrouter_token_expired, sign-in suggestion', () => {
    const err = classifyError(upstream401, {
      provider: 'anyrouter',
      userAnyRouterToken: true,
    })
    expect(err.type).toBe('auth_error')
    expect(err.code).toBe(ANYROUTER_TOKEN_EXPIRED_CODE)
    expect(err.suggestion).toContain('Sign in with AnyRouter')
  })

  test('fires on the AI SDK APICallError the provider actually throws', () => {
    const sdkError = new APICallError({
      message: 'Unauthorized',
      url: 'https://anyrouter.dev/api/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 401,
      responseBody: '{"error":{"message":"invalid token"}}',
    })
    const err = classifyError(sdkError, {
      provider: 'anyrouter',
      userAnyRouterToken: true,
    })
    expect(err.code).toBe(ANYROUTER_TOKEN_EXPIRED_CODE)
  })

  test('deployment-key 401 or another provider keeps the old classification', () => {
    for (const context of [
      { provider: 'anyrouter' },
      { provider: 'anyrouter', userAnyRouterToken: false },
      { provider: 'openrouter', userAnyRouterToken: true },
    ]) {
      const err = classifyError(upstream401, context)
      expect(err.type).toBe('auth_error')
      expect(err.code).not.toBe(ANYROUTER_TOKEN_EXPIRED_CODE)
    }
  })
})

describe('flag helpers', () => {
  test('CHM_AGENT_ANYROUTER_SIGNIN_ENABLED fails closed', () => {
    for (const v of [undefined, '', 'false', '0', 'junk', 'off']) {
      expect(parseAnyRouterSigninEnabled(v)).toBe(false)
    }
    for (const v of ['true', '1', 'yes', 'on', ' TRUE ']) {
      expect(parseAnyRouterSigninEnabled(v)).toBe(true)
    }
  })

  test('only `anyrouter:` ids route to AnyRouter', () => {
    expect(isAnyRouterProviderModel('anyrouter:auto')).toBe(true)
    expect(isAnyRouterProviderModel('anyrouter:anyrouter/free')).toBe(true)
    expect(isAnyRouterProviderModel('anyrouter/free')).toBe(false)
    expect(isAnyRouterProviderModel('openai:gpt-4o')).toBe(false)
    expect(isAnyRouterProviderModel(undefined)).toBe(false)
  })
})
