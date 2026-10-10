/**
 * "Sign in with AnyRouter" for guests: `hardenGuestAgentRequest` keeps a
 * guest's own AnyRouter token only when CHM_AGENT_ANYROUTER_SIGNIN_ENABLED is
 * on, and only with AnyRouter models. Flag off must be today's hardening
 * exactly, so a guest cannot skip the free daily cap with a junk key.
 */

import {
  hardenGuestAgentRequest,
  parseAgentRequest,
} from '../-agent/request-parsing'
import { describe, expect, test } from 'bun:test'
import { GUEST_DEFAULT_AGENT_MODEL } from '@/lib/billing/guest-ai'

const GUEST_TOKEN = 'ar-guest-token-123456'

async function parse(body: Record<string, unknown>) {
  const result = await parseAgentRequest(
    new Request('https://example.com/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', ...body }),
    })
  )
  if (!result.ok) throw new Error('parse failed')
  return result
}

describe('hardenGuestAgentRequest — Sign in with AnyRouter', () => {
  test('flag off (default): the guest token is dropped and the model forced', async () => {
    const parsed = await parse({
      apiKey: GUEST_TOKEN,
      model: 'anyrouter:openai/gpt-5',
    })
    for (const hardened of [
      hardenGuestAgentRequest(parsed),
      hardenGuestAgentRequest(parsed, { anyrouterSigninEnabled: false }),
    ]) {
      expect(hardened.byokApiKey).toBeNull()
      expect(hardened.body.apiKey).toBeUndefined()
      expect(hardened.body.model).toBe(GUEST_DEFAULT_AGENT_MODEL)
    }
  })

  test('flag on + token: keeps the token and the chosen AnyRouter model', async () => {
    const hardened = hardenGuestAgentRequest(
      await parse({ apiKey: GUEST_TOKEN, model: 'anyrouter:openai/gpt-5' }),
      { anyrouterSigninEnabled: true }
    )
    expect(hardened.byokApiKey).toBe(GUEST_TOKEN)
    expect(hardened.body.model).toBe('anyrouter:openai/gpt-5')
  })

  test('flag on + token + non-AnyRouter model: token kept, model forced to the guest default', async () => {
    // The token is AnyRouter-only and must never be sent to another provider.
    // `anyrouter/free` without the `anyrouter:` prefix routes to OpenRouter.
    for (const model of [
      'openai:gpt-4o',
      'openrouter/auto',
      'anyrouter/free',
    ]) {
      const hardened = hardenGuestAgentRequest(
        await parse({ apiKey: GUEST_TOKEN, model }),
        { anyrouterSigninEnabled: true }
      )
      expect(hardened.byokApiKey).toBe(GUEST_TOKEN)
      expect(hardened.body.model).toBe(GUEST_DEFAULT_AGENT_MODEL)
    }
  })

  test('flag on + token: MCP servers and host clamp still apply', async () => {
    const hardened = hardenGuestAgentRequest(
      await parse({
        apiKey: GUEST_TOKEN,
        model: 'anyrouter:openai/gpt-5',
        hostId: -2,
        mcpServers: [
          { id: 'evil', name: 'evil', endpoint: 'https://mcp.example.com' },
        ],
      }),
      { anyrouterSigninEnabled: true }
    )
    expect(hardened.mcpServers).toEqual([])
    expect(hardened.body.mcpServers).toBeUndefined()
    expect(hardened.hostId).toBe(0)
  })

  test('flag on, no token: the free demo default and allowlist are unchanged', async () => {
    const hardened = hardenGuestAgentRequest(
      await parse({ model: 'anyrouter:openai/gpt-5' }),
      { anyrouterSigninEnabled: true }
    )
    expect(hardened.byokApiKey).toBeNull()
    expect(hardened.body.model).toBe(GUEST_DEFAULT_AGENT_MODEL)
  })
})
