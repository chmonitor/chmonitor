import {
  enforceAuth,
  getApiKeyAuthFailure,
  isAuthenticatedRequest,
} from '../api-guard'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { issueApiKey } from '@chm/mcp-server/auth'

const TEST_SECRET = 'test-secret-key-for-unit-tests-at-least-32-chars'

const ENV_KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
  'CLERK_SECRET_KEY',
] as const

function anonReq(): Request {
  return new Request('https://dash.example.com/api/health')
}

describe('isAuthenticatedRequest', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns true for a fully-open deployment (provider=none, no API key)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    expect(await isAuthenticatedRequest(anonReq())).toBe(true)
  })

  it('returns true for a valid chm_ API key', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const key = await issueApiKey('test')
    const req = new Request('https://dash.example.com/api/health', {
      headers: { authorization: `Bearer ${key}` },
    })
    expect(await isAuthenticatedRequest(req)).toBe(true)
  })

  it('returns false for an anonymous request when api-key auth is on but no token is sent', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    expect(await isAuthenticatedRequest(anonReq())).toBe(false)
  })

  it('returns true for a valid chm_ key sent as x-api-key', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const key = await issueApiKey('test-x-api-key')
    const req = new Request('https://dash.example.com/api/health', {
      headers: { 'x-api-key': key },
    })
    expect(await isAuthenticatedRequest(req)).toBe(true)
  })

  // The core #1768 regression: public read-only mode lets anonymous users read
  // dashboard DATA, but must NOT expose deployment metadata. isAuthenticatedRequest
  // deliberately ignores publicReadEnabled(), unlike enforceAuth.
  it('returns false for anonymous clerk requests even when public-read is enabled', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    expect(await isAuthenticatedRequest(anonReq())).toBe(false)
  })

  // Contrast: in the exact same config, the data-access guard (enforceAuth)
  // DOES let the anonymous request through (returns null = allow). This is what
  // defeated the first #1768 fix on the public-read production deployment.
  it('diverges from enforceAuth: enforceAuth allows the same anonymous public-read request', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    expect(await enforceAuth(anonReq())).toBeNull()
    expect(await isAuthenticatedRequest(anonReq())).toBe(false)
  })
})

describe('GET /api/v1/openapi.json is a public discovery document', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function openApiReq(): Request {
    return new Request('https://dash.example.com/api/v1/openapi.json')
  }

  it('passes anonymous callers when clerk requires a session', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    const result = await getApiKeyAuthFailure(openApiReq())
    expect(result).toBeNull()
  })

  it('passes anonymous callers when API-key auth is on', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(openApiReq())
    expect(result).toBeNull()
  })
})

describe('x-api-key parity on /api/v1/*', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function hostsReq(headers?: HeadersInit): Request {
    return new Request('https://dash.example.com/api/v1/hosts', { headers })
  }

  it('accepts a valid chm_ key via x-api-key when API-key auth is on', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const key = await issueApiKey('cli')
    const result = await getApiKeyAuthFailure(hostsReq({ 'x-api-key': key }))
    expect(result).toBeNull()
  })

  it('returns 401 when API-key auth is on and no key is sent', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(hostsReq())
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })
})

describe('GET /api/v1/releases is a public changelog document', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function releasesReq(): Request {
    return new Request('https://dash.example.com/api/v1/releases')
  }

  it('passes anonymous callers when clerk requires a session', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    const result = await getApiKeyAuthFailure(releasesReq())
    expect(result).toBeNull()
  })
})

describe('GET /api/v1/mcp/info is public MCP metadata', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function mcpInfoReq(): Request {
    return new Request('https://dash.example.com/api/v1/mcp/info')
  }

  it('passes anonymous callers when clerk requires a session', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    const result = await getApiKeyAuthFailure(mcpInfoReq())
    expect(result).toBeNull()
  })

  it('passes anonymous callers when API-key auth is on', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(mcpInfoReq())
    expect(result).toBeNull()
  })
})

describe('device-flow paths are public (handler owns auth)', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('allows anonymous approve when API-key auth is on (device-only self-hosted)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(
      new Request('https://dash.example.com/api/v1/auth/device/approve', {
        method: 'POST',
      })
    )
    expect(result).toBeNull()
  })

  it('allows anonymous device status discovery', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(
      new Request('https://dash.example.com/api/v1/auth/device/status')
    )
    expect(result).toBeNull()
  })
})

describe('GET /api/v1/auth/cli is public CLI discovery', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  function cliAuthReq(): Request {
    return new Request('https://dash.example.com/api/v1/auth/cli')
  }

  it('passes anonymous callers when API-key auth is on', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(cliAuthReq())
    expect(result).toBeNull()
  })

  it('passes anonymous callers when clerk requires a session', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const result = await getApiKeyAuthFailure(cliAuthReq())
    expect(result).toBeNull()
  })
})
