/**
 * Cloud guest allow for agent routes. Agent is a write; Clerk public-read
 * still 401s unsigned POSTs. The wrapper must allow Cloud demo guests
 * without opening OSS Clerk or other write routes.
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
  'CHM_FEATURE_AGENT_ACCESS',
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

function agentPost(url = 'https://dash.chmonitor.dev/api/v1/agent'): Request {
  return new Request(url, { method: 'POST' })
}

describe('authorizeAgentApiRequest — Cloud guest allow', () => {
  beforeEach(async () => {
    clearEnv()
    clerkAuthResult = null
    await resetConfig()
  })

  afterEach(async () => {
    clearEnv()
    await resetConfig()
  })

  test('Cloud + public-read + unsigned POST /api/v1/agent is not 401', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'
    clerkAuthResult = null

    const { authorizeAgentApiRequest } = await import('./agent-api-auth')
    const denied = await authorizeAgentApiRequest(agentPost())
    expect(denied).toBeNull()
  })

  test('OSS Clerk + public-read still 401s unsigned agent when access=authenticated', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'false'
    clerkAuthResult = null

    const { authorizeAgentApiRequest } = await import('./agent-api-auth')
    const denied = await authorizeAgentApiRequest(agentPost())
    expect(denied).not.toBeNull()
    expect(denied?.status).toBe(401)
  })

  test('does not open unsigned Cloud MCP probe (not on the guest allowlist)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'

    const { authorizeAgentApiRequest } = await import('./agent-api-auth')
    const denied = await authorizeAgentApiRequest(
      new Request('https://dash.chmonitor.dev/api/v1/mcp/probe', {
        method: 'POST',
      })
    )
    expect(denied?.status).toBe(401)
  })

  test('allows unsigned Cloud models / config-check / followups', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    process.env.CHM_CLOUD_MODE = 'true'

    const { authorizeAgentApiRequest } = await import('./agent-api-auth')
    for (const path of [
      '/api/v1/agents/models',
      '/api/v1/agents/config-check',
      '/api/v1/agent/followups',
    ]) {
      const denied = await authorizeAgentApiRequest(
        new Request(`https://dash.chmonitor.dev${path}`)
      )
      expect(denied).toBeNull()
    }
  })
})
