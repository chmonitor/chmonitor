/**
 * Tests for the anonymous-cloud carve-out on POST /api/v1/insights/generate
 * (lib/auth/insights-api-auth.ts). Mirrors agent-api-auth.test.ts: the write
 * gate still 401s anonymous callers EXCEPT anonymous cloud visitors on the
 * generate path, so the public demo host can produce insights without sign-in.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let clerkAuthResult: { userId?: string } | null = null
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => clerkAuthResult,
}))

const ENV_KEYS = [
  'CHM_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_CLOUD_MODE',
  'CHM_DEPLOYMENT_MODE',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function resetConfig(): Promise<void> {
  const { _resetAppConfigCache } = await import(
    '@/lib/feature-permissions/server'
  )
  _resetAppConfigCache()
}

function generateRequest(url = 'http://x/api/v1/insights/generate'): Request {
  return new Request(url, { method: 'POST' })
}

describe('authorizeInsightsGenerateRequest — anonymous cloud guest carve-out', () => {
  beforeEach(async () => {
    clearEnv()
    clerkAuthResult = null
    await resetConfig()
  })

  afterEach(async () => {
    clearEnv()
    await resetConfig()
  })

  test('anonymous cloud visitor on generate: allowed (carve-out)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'
    clerkAuthResult = null

    const { authorizeInsightsGenerateRequest } = await import(
      '../insights-api-auth'
    )
    const res = await authorizeInsightsGenerateRequest(generateRequest())
    expect(res).toBeNull()
  })

  test('anonymous OSS visitor: still denied (401)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'false'
    clerkAuthResult = null

    const { authorizeInsightsGenerateRequest } = await import(
      '../insights-api-auth'
    )
    const res = await authorizeInsightsGenerateRequest(generateRequest())
    expect(res?.status).toBe(401)
  })

  test('signed-in cloud user: allowed via the normal auth path', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'
    clerkAuthResult = { userId: 'user_123' }

    const { authorizeInsightsGenerateRequest } = await import(
      '../insights-api-auth'
    )
    const res = await authorizeInsightsGenerateRequest(generateRequest())
    expect(res).toBeNull()
  })

  test('non-generate path is not carved out', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'
    clerkAuthResult = null

    const { authorizeInsightsGenerateRequest } = await import(
      '../insights-api-auth'
    )
    const res = await authorizeInsightsGenerateRequest(
      generateRequest('http://x/api/v1/insights')
    )
    expect(res?.status).toBe(401)
  })
})
