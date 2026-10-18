/**
 * The alert config GETs return operator config, so in cloud mode they need a
 * signed-in caller. Self-hosted anonymous callers keep reading them.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const routes = [
  ['alert-config', (await import('../alert-config')).__handleGetForTests],
  ['webhook-targets', (await import('../webhook-targets')).__handleGetForTests],
  ['routes', (await import('../routes')).__handleGetForTests],
  ['maint-windows', (await import('../maint-windows')).__handleGetForTests],
  ['quiet-hours', (await import('../quiet-hours')).__handleGetForTests],
  ['peerdb-rules', (await import('../peerdb-rules')).__handleGetForTests],
] as const

const KEYS = [
  'CHM_CLOUD_MODE',
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const req = () => new Request('https://dash.example.com/api/v1/health/x')

describe('alert config reads in cloud mode', () => {
  for (const [name, handleGet] of routes) {
    test(`${name}: anonymous cloud GET is rejected with 401`, async () => {
      process.env.CHM_CLOUD_MODE = 'true'
      process.env.CHM_AUTH_PROVIDER = 'clerk'
      process.env.CHM_CLERK_PUBLIC_READ = 'true'
      const res = await handleGet(req())
      expect(res.status).toBe(401)
      expect((await res.json()) as unknown).toEqual({
        error: 'Authentication required',
      })
    })

    test(`${name}: self-hosted anonymous GET is not auth-gated`, async () => {
      const res = await handleGet(req())
      expect(res.status).toBe(200)
    })

    test(`${name}: self-hosted clerk anonymous GET is not auth-gated`, async () => {
      process.env.CHM_AUTH_PROVIDER = 'clerk'
      const res = await handleGet(req())
      expect(res.status).toBe(200)
    })
  }
})
