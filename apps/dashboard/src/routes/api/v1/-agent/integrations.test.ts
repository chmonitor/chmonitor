/**
 * Route-level resolution of the integration tools (#3674): the probe result is
 * pinned per conversation (turn 2 reuses turn 1 even after the probe changes),
 * anonymous cloud visitors never get the tools (and never trigger a probe),
 * and the structured log never carries a URL.
 */

import type { IntegrationGateInput } from '@/lib/ai/agent/integration-tools-gate'

import {
  integrationPromptHint,
  resetIntegrationLogState,
  resolveAgentIntegrations,
} from './integrations'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  INTEGRATION_PIN_PART_TYPE,
  readIntegrationPin,
} from '@/lib/ai/agent/integration-tools-gate'

function fakeProbe(results: Record<string, boolean>) {
  const calls: string[] = []
  return {
    calls,
    probeCache: {
      check: async (name: 'peerdb' | 'postgres') => {
        calls.push(name)
        return results[name]
          ? ({ ok: true } as const)
          : ({ ok: false, kind: 'refused' } as const)
      },
      clear() {},
    },
  }
}

function gates(
  ctx: { cloud?: boolean; signedIn?: boolean; ownConnection?: boolean },
  flag?: string
): Record<'peerdb' | 'postgres', IntegrationGateInput> {
  const g: IntegrationGateInput = {
    flag,
    configured: true,
    cloud: ctx.cloud ?? false,
    signedIn: ctx.signedIn ?? true,
    ownConnection: ctx.ownConnection ?? false,
  }
  return { peerdb: { ...g }, postgres: { ...g } }
}

let logSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  resetIntegrationLogState()
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

describe('resolveAgentIntegrations', () => {
  test('auto-enables reachable integrations on self-hosted', async () => {
    const p = fakeProbe({ peerdb: true, postgres: false })
    const r = await resolveAgentIntegrations({
      cloud: false,
      signedIn: true,
      ownConnection: false,
      pin: undefined,
      probeCache: p.probeCache,
      gateInputs: gates({}),
    })
    expect(r.integrations).toEqual({ peerdb: true, postgres: false })
    expect(r.pin).toEqual({
      peerdb: { ok: true },
      postgres: { ok: false, kind: 'refused' },
    })
  })

  test('turn 2 reuses the pinned result even after reachability changes', async () => {
    const turn1 = await resolveAgentIntegrations({
      cloud: false,
      signedIn: true,
      ownConnection: false,
      pin: undefined,
      probeCache: fakeProbe({ peerdb: true, postgres: true }).probeCache,
      gateInputs: gates({}),
    })
    // The pin travels with the conversation as an assistant data part.
    const history = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        parts: [{ type: INTEGRATION_PIN_PART_TYPE, data: [turn1.pin] }],
      },
    ]

    const flipped = fakeProbe({ peerdb: false, postgres: false })
    const turn2 = await resolveAgentIntegrations({
      cloud: false,
      signedIn: true,
      ownConnection: false,
      pin: readIntegrationPin(history),
      probeCache: flipped.probeCache,
      gateInputs: gates({}),
    })
    expect(turn2.integrations).toEqual(turn1.integrations)
    expect(flipped.calls).toEqual([])
  })

  test('a pin never bypasses a kill switch set later', async () => {
    const r = await resolveAgentIntegrations({
      cloud: false,
      signedIn: true,
      ownConnection: false,
      pin: { peerdb: { ok: true }, postgres: { ok: true } },
      probeCache: fakeProbe({}).probeCache,
      gateInputs: gates({}, 'false'),
    })
    expect(r.integrations).toEqual({ peerdb: false, postgres: false })
  })

  test('anonymous cloud visitors never get the tools, even with flag=true', async () => {
    const p = fakeProbe({ peerdb: true, postgres: true })
    for (const flag of [undefined, 'true']) {
      const r = await resolveAgentIntegrations({
        cloud: true,
        signedIn: false,
        ownConnection: false,
        pin: { peerdb: { ok: true }, postgres: { ok: true } },
        probeCache: p.probeCache,
        gateInputs: gates({ cloud: true, signedIn: false }, flag),
      })
      expect(r.integrations).toEqual({ peerdb: false, postgres: false })
      expect(r.decisions.peerdb.reason).toBe('cloud_anon')
    }
    expect(p.calls).toEqual([])
  })

  test('logs one structured line per state change, without URLs', async () => {
    const input = {
      cloud: false,
      signedIn: true,
      ownConnection: false,
      pin: undefined,
      probeCache: fakeProbe({ peerdb: false, postgres: true }).probeCache,
      gateInputs: gates({}),
    }
    await resolveAgentIntegrations(input)
    await resolveAgentIntegrations(input)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toBe('agent.integration_tools')
    expect(logSpy.mock.calls[0][1]).toEqual({
      caller: 'oss:user:env',
      peerdb: 'off',
      postgres: 'on',
      reason: { peerdb: 'unreachable:refused', postgres: 'auto' },
    })
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('://')
  })
})

describe('integration log dedup', () => {
  test('alternating caller classes log once per class, not per request', async () => {
    const p = fakeProbe({ peerdb: true, postgres: true })
    for (let i = 0; i < 4; i++) {
      for (const signedIn of [false, true]) {
        await resolveAgentIntegrations({
          cloud: true,
          signedIn,
          ownConnection: false,
          pin: undefined,
          probeCache: p.probeCache,
          gateInputs: gates({ cloud: true, signedIn }),
        })
      }
    }
    expect(logSpy).toHaveBeenCalledTimes(2)
  })
})

describe('integrationPromptHint', () => {
  test('is empty when nothing is on and names search_tools otherwise', () => {
    expect(integrationPromptHint({ peerdb: false, postgres: false })).toBe('')
    const hint = integrationPromptHint({ peerdb: true, postgres: false })
    expect(hint).toContain('PeerDB')
    expect(hint).toContain('search_tools')
    expect(hint).not.toContain('Postgres')
  })
})
