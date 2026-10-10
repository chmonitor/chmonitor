/**
 * One resolver, every reader agrees.
 *
 * Before this, CHM_CLOUD_MODE=yes, CHM_FEATURE_*=1 and an unset
 * CHM_AUTH_PROVIDER each meant different things depending on which file read
 * them (a Docker image run with only CHM_DEPLOYMENT_MODE=cloud got auth
 * 'none'). These tests run the same env through every former call site and
 * require the same answer, and pin the fail-closed-to-oss invariant: junk never
 * enables cloud, clerk, or public read.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

import { publicReadEnabled as guardPublicRead } from '@/lib/auth/api-guard'
import { resolveCliAuthDiscovery } from '@/lib/auth/cli-auth-discovery'
import { getAuthProvider } from '@/lib/auth/provider'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { bakeBool, resolveClientFlagEnv } from '@/lib/config/client-env'
import { resolveConfig } from '@/lib/config/deployment-mode'
import { parseBool } from '@/lib/config/parse-bool'
import { getServerAuthProvider } from '@/lib/env'

const KEYS = [
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_CLOUD_MODE',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('parseBool — the one boolean grammar', () => {
  test.each([
    ['true', true],
    ['TRUE', true],
    [' 1 ', true],
    ['yes', true],
    ['On', true],
    ['false', false],
    ['0', false],
    ['NO', false],
    ['off', false],
    [undefined, undefined],
    [null, undefined],
    ['', undefined],
    ['   ', undefined],
    ['maybe', undefined],
    ['cloud', undefined],
    ['2', undefined],
  ] as const)('%p → %p', (input, expected) => {
    expect(parseBool(input)).toBe(expected)
  })
})

describe('CHM_CLOUD_MODE: resolveConfig and isCloudModeServer agree', () => {
  test.each([
    ['yes', true],
    ['1', true],
    ['true', true],
    ['cloud', true],
    ['no', false],
    ['false', false],
    ['junk', false],
  ] as const)('CHM_CLOUD_MODE=%p → %p', (value, expected) => {
    const env = { CHM_CLOUD_MODE: value }
    expect(resolveConfig((k) => env[k as keyof typeof env]).cloudMode).toBe(
      expected
    )
    expect(isCloudModeServer(env)).toBe(expected)
  })
})

// Under bun test there is no baked VITE_AUTH_PROVIDER / VITE_DEPLOYMENT_MODE,
// so the build-time fallback is the oss default ('none').
const MODES = [undefined, 'oss', 'cloud', 'junk'] as const
const AUTHS = [undefined, 'none', 'clerk'] as const

function expectedAuth(
  mode: string | undefined,
  auth: string | undefined
): string {
  if (auth) return auth
  return mode === 'cloud' ? 'clerk' : 'none'
}

describe('auth provider: every former call site gives the same answer', () => {
  for (const mode of MODES) {
    for (const auth of AUTHS) {
      test(`mode=${mode ?? 'unset'} × CHM_AUTH_PROVIDER=${auth ?? 'unset'}`, async () => {
        const env = { CHM_DEPLOYMENT_MODE: mode, CHM_AUTH_PROVIDER: auth }
        setEnv(env)
        const want = expectedAuth(mode, auth)
        const getEnv = (k: string) => env[k as keyof typeof env]

        const { getAppConfig, _resetAppConfigCache } = await import(
          '@/lib/feature-permissions/server'
        )
        _resetAppConfigCache()

        const answers = {
          getAuthProvider: getAuthProvider(),
          getAuthProviderInjected: getAuthProvider(getEnv),
          getServerAuthProvider: getServerAuthProvider(env),
          resolveConfig: resolveConfig(getEnv).authProvider,
          cliAuthDiscovery: resolveCliAuthDiscovery(env).authProvider,
          featurePermissions: getAppConfig().authProvider,
        }
        for (const answer of Object.values(answers)) expect(answer).toBe(want)
      })
    }
  }

  test('junk CHM_AUTH_PROVIDER never resolves to clerk', () => {
    const env = { CHM_DEPLOYMENT_MODE: 'cloud', CHM_AUTH_PROVIDER: 'bogus' }
    expect(() => getAuthProvider((k) => env[k as keyof typeof env])).toThrow()
    // Discovery/device-login swallow the config error and fail closed.
    expect(resolveCliAuthDiscovery(env).authProvider).toBe('none')
  })
})

describe('publicReadEnabled: api-guard and feature-permissions agree', () => {
  const cases: Array<[string | undefined, string | undefined, boolean]> = [
    [undefined, undefined, false],
    ['oss', undefined, false],
    ['junk', undefined, false],
    ['cloud', undefined, true], // mode default: cloud serves the public demo
    ['cloud', 'false', false], // an explicit false still disables
    ['cloud', 'off', false],
    ['oss', 'true', true],
    ['oss', 'yes', true],
    [undefined, '1', true],
    ['cloud', 'maybe', true], // junk → mode default
    ['oss', 'maybe', false],
  ]
  test.each(
    cases
  )('mode=%p CHM_CLERK_PUBLIC_READ=%p → %p', async (mode, publicRead, expected) => {
    setEnv({ CHM_DEPLOYMENT_MODE: mode, CHM_CLERK_PUBLIC_READ: publicRead })
    const { publicReadEnabled: permissionsPublicRead } = await import(
      '@/lib/feature-permissions/server'
    )
    expect(guardPublicRead()).toBe(expected)
    expect(permissionsPublicRead()).toBe(expected)
  })
})

describe('vite build bakes canonical client values', () => {
  test('=1 and =yes bake "true"; junk bakes "false"; unset → mode default', () => {
    expect(bakeBool('1', false)).toBe('true')
    expect(bakeBool('yes', false)).toBe('true')
    expect(bakeBool('TRUE', false)).toBe('true')
    expect(bakeBool('0', true)).toBe('false')
    expect(bakeBool('maybe', true)).toBe('false')
    expect(bakeBool(undefined, true)).toBe('true')
    expect(bakeBool('', false)).toBe('false')
  })

  test('CHM_FEATURE_USER_CONNECTIONS_DB=1 bakes VITE_* = "true"', () => {
    const out = resolveClientFlagEnv(
      {
        CHM_FEATURE_USER_CONNECTIONS_DB: '1',
        CHM_FEATURE_CONVERSATION_DB: 'yes',
      },
      false
    )
    expect(out.VITE_FEATURE_USER_CONNECTIONS_DB).toBe('true')
    expect(out.VITE_FEATURE_CONVERSATION_DB).toBe('true')
  })

  test('explicit VITE_* wins over CHM_*', () => {
    const out = resolveClientFlagEnv(
      {
        VITE_FEATURE_USER_CONNECTIONS_DB: 'false',
        CHM_FEATURE_USER_CONNECTIONS_DB: 'true',
        VITE_AUTH_PROVIDER: 'none',
        CHM_AUTH_PROVIDER: 'clerk',
      },
      true
    )
    expect(out.VITE_FEATURE_USER_CONNECTIONS_DB).toBe('false')
    expect(out.VITE_AUTH_PROVIDER).toBe('none')
  })

  test('unset auth bakes empty, even for a cloud build', () => {
    expect(resolveClientFlagEnv({}, false).VITE_AUTH_PROVIDER).toBe('')
    expect(resolveClientFlagEnv({}, true).VITE_AUTH_PROVIDER).toBe('')
    expect(
      resolveClientFlagEnv({ CHM_AUTH_PROVIDER: 'clerk' }, false)
        .VITE_AUTH_PROVIDER
    ).toBe('clerk')
  })

  test('cloud build defaults the per-user flags on; oss off', () => {
    expect(
      resolveClientFlagEnv({}, true).VITE_FEATURE_USER_CONNECTIONS_DB
    ).toBe('true')
    expect(
      resolveClientFlagEnv({}, false).VITE_FEATURE_USER_CONNECTIONS_DB
    ).toBe('false')
    // Postgres / fleet stay off in both modes.
    expect(resolveClientFlagEnv({}, true).VITE_FEATURE_POSTGRES_SOURCE).toBe(
      'false'
    )
  })

  test('legacy NEXT_PUBLIC_* is ignored', () => {
    const out = resolveClientFlagEnv(
      {
        NEXT_PUBLIC_AUTH_PROVIDER: 'clerk',
        NEXT_PUBLIC_FEATURE_USER_CONNECTIONS_DB: 'true',
      },
      false
    )
    expect(out.VITE_AUTH_PROVIDER).toBe('')
    expect(out.VITE_FEATURE_USER_CONNECTIONS_DB).toBe('false')
  })
})

describe('a baked provider is never lowered by a runtime mode', () => {
  // Review finding on the resolver PR: a self-build baked with clerk and run
  // with only CHM_DEPLOYMENT_MODE=oss used to resolve the server to `none`
  // (every API route open) while the client still showed sign-in.
  test('baked clerk + runtime oss → clerk', () => {
    const saved = process.env.VITE_AUTH_PROVIDER
    process.env.VITE_AUTH_PROVIDER = 'clerk'
    try {
      const env: Record<string, string> = { CHM_DEPLOYMENT_MODE: 'oss' }
      expect(getAuthProvider((k) => env[k])).toBe('clerk')
      // An explicit runtime provider still wins.
      env.CHM_AUTH_PROVIDER = 'none'
      expect(getAuthProvider((k) => env[k])).toBe('none')
    } finally {
      if (saved === undefined) delete process.env.VITE_AUTH_PROVIDER
      else process.env.VITE_AUTH_PROVIDER = saved
    }
  })
})
