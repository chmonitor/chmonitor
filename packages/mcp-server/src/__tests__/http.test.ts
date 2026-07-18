import { issueApiKey } from '../auth/api-key'
import {
  apiKeyAuthenticator,
  buildServerInfo,
  corsPreflight,
  defaultAuthenticator,
  handleMcp,
  handleMcpInfo,
  normalizePath,
  withCors,
} from '../http'
import { afterEach, describe, expect, it } from 'bun:test'

const TEST_SECRET = 'test-secret-key-for-unit-tests-at-least-32-chars'

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/mcp', { method: 'POST', headers })
}

describe('mcp http', () => {
  const originalSecret = process.env.CHM_API_KEY_SECRET
  const originalPublic = process.env.CHM_MCP_PUBLIC

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.CHM_API_KEY_SECRET = originalSecret
    } else {
      delete process.env.CHM_API_KEY_SECRET
    }
    if (originalPublic !== undefined) {
      process.env.CHM_MCP_PUBLIC = originalPublic
    } else {
      delete process.env.CHM_MCP_PUBLIC
    }
  })

  describe('withCors / corsPreflight', () => {
    it('adds permissive CORS headers', () => {
      const res = withCors(new Response('ok'))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })

    it('preflight is 204 with CORS', () => {
      const res = corsPreflight()
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('normalizePath', () => {
    it('strips trailing slashes but preserves root', () => {
      expect(normalizePath('/api/mcp/')).toBe('/api/mcp')
      expect(normalizePath('/api/mcp')).toBe('/api/mcp')
      expect(normalizePath('/')).toBe('/')
    })
  })

  describe('defaultAuthenticator', () => {
    it('401s when no auth is configured and CHM_MCP_PUBLIC is not set', async () => {
      delete process.env.CHM_API_KEY_SECRET
      delete process.env.CHM_MCP_PUBLIC
      const res = await defaultAuthenticator(req())
      expect(res?.status).toBe(401)
    })

    it('allows anonymous when CHM_MCP_PUBLIC=true and no auth is configured', async () => {
      delete process.env.CHM_API_KEY_SECRET
      process.env.CHM_MCP_PUBLIC = 'true'
      expect(await defaultAuthenticator(req())).toBeNull()
    })

    it('401s when api-key is configured but no token is provided', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      delete process.env.CHM_MCP_PUBLIC
      const res = await defaultAuthenticator(req())
      expect(res?.status).toBe(401)
    })

    it('allows a valid api-key even when CHM_MCP_PUBLIC is unset', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      delete process.env.CHM_MCP_PUBLIC
      const key = await issueApiKey('test')
      expect(
        await defaultAuthenticator(req({ authorization: `Bearer ${key}` }))
      ).toBeNull()
    })
  })

  describe('apiKeyAuthenticator', () => {
    it('allows anonymous when no secret is configured (open case)', async () => {
      delete process.env.CHM_API_KEY_SECRET
      expect(await apiKeyAuthenticator(req())).toBeNull()
    })

    it('401s when secret is set but no token is provided', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const res = await apiKeyAuthenticator(req())
      expect(res?.status).toBe(401)
      // failures are CORS-wrapped so browser clients can read the status
      expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('401s on an invalid token', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const res = await apiKeyAuthenticator(
        req({ authorization: 'Bearer not-a-real-key' })
      )
      expect(res?.status).toBe(401)
    })

    it('allows a valid issued key (bearer or x-api-key)', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const key = await issueApiKey('test')
      expect(
        await apiKeyAuthenticator(req({ authorization: `Bearer ${key}` }))
      ).toBeNull()
      expect(await apiKeyAuthenticator(req({ 'x-api-key': key }))).toBeNull()
    })
  })

  describe('handleMcp auth gate', () => {
    it('short-circuits with the authenticator response and never runs the server', async () => {
      const sentinel = new Response('nope', { status: 403 })
      const res = await handleMcp(req(), {
        authenticate: async () => sentinel,
      })
      expect(res.status).toBe(403)
      // a custom authenticator's bare Response is CORS-wrapped on the way out
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('returns a CORS-wrapped 500 when the authenticator throws', async () => {
      const res = await handleMcp(req(), {
        authenticate: async () => {
          throw new Error('boom')
        },
      })
      expect(res.status).toBe(500)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('honors a custom authenticator that allows through', async () => {
      // We can't assert full MCP protocol output here, but reaching the
      // transport (any non-403) proves the gate passed.
      const res = await handleMcp(req({ 'content-type': 'application/json' }), {
        authenticate: async () => null,
      })
      expect(res.status).not.toBe(403)
    })
  })

  describe('handleMcp rate-limit gate (#2728)', () => {
    it('short-circuits with the rate-limit response before auth runs', async () => {
      let authRan = false
      const res = await handleMcp(req(), {
        rateLimitCheck: async () => new Response('slow down', { status: 429 }),
        authenticate: async () => {
          authRan = true
          return null
        },
      })
      expect(res.status).toBe(429)
      // rate-limit responses are CORS-wrapped so browser clients can read them
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      // cheap counter runs first; network-touching auth never fires
      expect(authRan).toBe(false)
    })

    it('proceeds to auth when the rate-limit check allows', async () => {
      const sentinel = new Response('nope', { status: 403 })
      const res = await handleMcp(req(), {
        rateLimitCheck: async () => null,
        authenticate: async () => sentinel,
      })
      expect(res.status).toBe(403)
    })

    it('gates handleMcpInfo through the same option', async () => {
      const res = await handleMcpInfo(
        new Request('https://example.com/api/v1/mcp/info'),
        { rateLimitCheck: async () => new Response('', { status: 429 }) }
      )
      expect(res.status).toBe(429)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('returns a CORS-wrapped 500 when the rate-limit check throws', async () => {
      const res = await handleMcp(req(), {
        rateLimitCheck: async () => {
          throw new Error('boom')
        },
      })
      expect(res.status).toBe(500)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('buildServerInfo / handleMcpInfo', () => {
    it('builds the expected server info payload', () => {
      const info = buildServerInfo()
      expect(info.name).toBe('chmonitor')
      // version is sourced live from package.json, not hardcoded
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
      expect(info.tools.length).toBeGreaterThan(0)
      expect(info.resources.map((r) => r.name)).toContain('system-tables')
    })

    it('401s info when no auth is configured and CHM_MCP_PUBLIC is not set', async () => {
      delete process.env.CHM_API_KEY_SECRET
      delete process.env.CHM_MCP_PUBLIC
      const res = await handleMcpInfo(
        new Request('https://example.com/api/v1/mcp/info')
      )
      expect(res.status).toBe(401)
    })

    it('returns info JSON with CORS when CHM_MCP_PUBLIC=true', async () => {
      delete process.env.CHM_API_KEY_SECRET
      process.env.CHM_MCP_PUBLIC = 'true'
      const res = await handleMcpInfo(
        new Request('https://example.com/api/v1/mcp/info')
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('chmonitor')
    })

    it('401s info when auth is required and no token is given', async () => {
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      delete process.env.CHM_MCP_PUBLIC
      const res = await handleMcpInfo(
        new Request('https://example.com/api/v1/mcp/info')
      )
      expect(res.status).toBe(401)
    })
  })
})
