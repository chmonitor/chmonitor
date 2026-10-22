/**
 * Enrichment output cap and the sweep switch (#4114).
 *
 * A short JSON rewrite must not ask the provider for its full output limit, and
 * the health sweep must be able to skip the LLM call entirely. The observable
 * signal for both is the (mocked) `generateObject` call.
 */

import type { InsightCandidate } from './types'

import * as collectorsModule from './collectors'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

interface GenerateObjectArgs {
  maxOutputTokens?: number
  prompt: string
}
const generateObjectCalls: GenerateObjectArgs[] = []
let generateObjectImpl: (args: GenerateObjectArgs) => Promise<unknown>

mock.module('ai', () => ({
  generateObject: async (args: GenerateObjectArgs) => {
    generateObjectCalls.push(args)
    return generateObjectImpl(args)
  },
}))
mock.module('../ai/agent/provider-chat-model', () => ({
  DEFAULT_MODEL: 'test:model',
  resolveAgentChatModel: () => ({ model: {} }),
}))
mock.module('../ai/providers', () => ({
  isProviderConfigured: () => true,
  resolveProvider: () => ({ providerId: 'test' }),
}))

const CANDIDATE: InsightCandidate = {
  severity: 'warning',
  category: 'storage',
  title: 'deterministic title',
  detail: 'deterministic detail',
  metric: 'max_active_parts',
  value: 318,
}

const collectInsightsSpy = spyOn(
  collectorsModule,
  'collectInsights'
).mockImplementation(async () => [CANDIDATE])

const { enrichInsights } = await import('./llm-enrich')
const { sweepInsightOptions } = await import('./enrich-config')
const { generateInsights } = await import('./generate-insights')
const { resetInsightsStoreCache } = await import('./store/resolve-store')

const ENV_KEYS = [
  'INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS',
  'INSIGHTS_SWEEP_ENRICH',
  'INSIGHTS_STORE_BACKEND',
] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.INSIGHTS_STORE_BACKEND = 'memory'
  resetInsightsStoreCache()
  generateObjectCalls.length = 0
  generateObjectImpl = async () => ({
    object: {
      insights: [{ title: 'LLM title', detail: 'LLM detail' }],
    },
  })
})

afterEach(() => {
  resetInsightsStoreCache()
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  collectInsightsSpy.mockRestore()
})

describe('enrichInsights maxOutputTokens', () => {
  test('defaults to 4096 when the env is unset', async () => {
    await enrichInsights([CANDIDATE])
    expect(generateObjectCalls).toHaveLength(1)
    expect(generateObjectCalls[0].maxOutputTokens).toBe(4096)
  })

  test('uses a valid env value', async () => {
    process.env.INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS = '8192'
    await enrichInsights([CANDIDATE])
    expect(generateObjectCalls[0].maxOutputTokens).toBe(8192)
  })

  test('clamps a huge env value to the 16384 ceiling', async () => {
    process.env.INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS = '65536'
    await enrichInsights([CANDIDATE])
    expect(generateObjectCalls[0].maxOutputTokens).toBe(16384)
  })

  test.each([
    '',
    '   ',
    'abc',
    '0',
    '-5',
    '1.5',
    '12abc',
    '1e3',
  ])('falls back to 4096 for invalid value %p', async (raw) => {
    process.env.INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS = raw
    await enrichInsights([CANDIDATE])
    expect(generateObjectCalls[0].maxOutputTokens).toBe(4096)
  })

  test('keeps the deterministic text when the LLM call fails', async () => {
    generateObjectImpl = async () => {
      throw new Error('boom')
    }
    const out = await enrichInsights([CANDIDATE])
    expect(generateObjectCalls).toHaveLength(1)
    expect(out).toEqual([CANDIDATE])
  })
})

describe('INSIGHTS_SWEEP_ENRICH', () => {
  test('unset: the sweep enriches once per host', async () => {
    await generateInsights(0, { ...sweepInsightOptions(), force: true })
    await generateInsights(1, { ...sweepInsightOptions(), force: true })
    expect(generateObjectCalls).toHaveLength(2)
  })

  test.each([
    'true',
    '1',
    'yes',
    'on',
    'junk',
  ])('%p keeps enrichment on', async (raw) => {
    process.env.INSIGHTS_SWEEP_ENRICH = raw
    const out = await generateInsights(0, sweepInsightOptions())
    expect(generateObjectCalls).toHaveLength(1)
    expect(out[0].title).toBe('LLM title')
  })

  test.each([
    'false',
    '0',
    'no',
    'off',
  ])('%p makes the sweep store deterministic text with no LLM call', async (raw) => {
    process.env.INSIGHTS_SWEEP_ENRICH = raw
    const out = await generateInsights(0, sweepInsightOptions())
    expect(generateObjectCalls).toHaveLength(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      title: 'deterministic title',
      detail: 'deterministic detail',
    })
  })

  test('the UI/manual path still enriches when the sweep switch is off', async () => {
    process.env.INSIGHTS_SWEEP_ENRICH = 'false'
    const out = await generateInsights(0, { force: true })
    expect(generateObjectCalls).toHaveLength(1)
    expect(out[0].title).toBe('LLM title')
  })
})
