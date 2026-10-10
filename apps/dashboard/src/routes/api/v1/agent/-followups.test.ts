// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'

mock.module('server-only', () => ({}))
mock.module('cloudflare:workers', () => ({ env: {} }))

const { generateFollowupSuggestions, FOLLOWUPS_MAX_OUTPUT_TOKENS } =
  await import('./followups')

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function jsonModel(payload: unknown) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: USAGE,
      warnings: [],
    },
  })
}

function failingModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error('cheap model down')
    },
  })
}

const GOOD = { suggestions: ['Which tables are largest?', 'Any slow queries?'] }

describe('generateFollowupSuggestions', () => {
  test('uses the first model with a 200-token cap and skips the fallback', async () => {
    const cheap = jsonModel(GOOD)
    const requested = jsonModel(GOOD)
    const out = await generateFollowupSuggestions({
      context: 'user: hi',
      models: [cheap, requested],
    })
    expect(out.length).toBe(2)
    expect(FOLLOWUPS_MAX_OUTPUT_TOKENS).toBe(200)
    expect(cheap.doGenerateCalls[0].maxOutputTokens).toBe(200)
    expect(requested.doGenerateCalls.length).toBe(0)
  })

  test('falls back to the requested model when the cheap model fails', async () => {
    const requested = jsonModel(GOOD)
    const out = await generateFollowupSuggestions({
      context: 'user: hi',
      models: [failingModel(), requested],
    })
    expect(out.length).toBe(2)
    expect(requested.doGenerateCalls.length).toBe(1)
  })

  test('falls back when the cheap model returns too few suggestions', async () => {
    const requested = jsonModel(GOOD)
    const out = await generateFollowupSuggestions({
      context: 'user: hi',
      models: [jsonModel({ suggestions: ['Only one?'] }), requested],
    })
    expect(out.length).toBe(2)
  })

  test('throws when every model fails', async () => {
    await expect(
      generateFollowupSuggestions({
        context: 'x',
        models: [failingModel(), failingModel()],
      })
    ).rejects.toThrow('cheap model down')
  })
})
