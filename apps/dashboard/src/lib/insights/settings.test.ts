/**
 * Tests for the AI Insights settings model + prompt styles + server-side model
 * resolution. Pure logic — no ClickHouse, no LLM.
 */

import { getModelRegistry } from '../ai/agent-model-registry'
import {
  DEFAULT_PROMPT_STYLE,
  INSIGHT_PROMPT_STYLES,
  isInsightPromptStyle,
  promptSystemFor,
  resolvePromptStyle,
} from './prompts'
import { resolveInsightModel } from './resolve-model'
import {
  DEFAULT_INSIGHTS_SETTINGS,
  generateParamsFromSettings,
  isInsightWindow,
  sanitizeInsightsSettings,
} from './settings'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('prompt styles', () => {
  it('exposes concise/detailed/beginner with distinct system prompts', () => {
    const ids = INSIGHT_PROMPT_STYLES.map((s) => s.id)
    expect(ids).toEqual(['concise', 'detailed', 'beginner'])
    const systems = new Set(INSIGHT_PROMPT_STYLES.map((s) => s.system))
    expect(systems.size).toBe(3)
  })

  it('validates known style ids', () => {
    expect(isInsightPromptStyle('detailed')).toBe(true)
    expect(isInsightPromptStyle('nope')).toBe(false)
    expect(isInsightPromptStyle(null)).toBe(false)
  })

  it('falls back to the default style for unknown ids', () => {
    expect(resolvePromptStyle('bogus').id).toBe(DEFAULT_PROMPT_STYLE)
    expect(promptSystemFor(undefined)).toBe(
      resolvePromptStyle(DEFAULT_PROMPT_STYLE).system
    )
  })

  it('selects the requested style prompt when valid', () => {
    expect(promptSystemFor('beginner')).toContain('plain language')
    expect(promptSystemFor('detailed')).toContain('root cause')
  })
})

describe('sanitizeInsightsSettings', () => {
  it('returns defaults for null/garbage input', () => {
    expect(sanitizeInsightsSettings(null)).toEqual(DEFAULT_INSIGHTS_SETTINGS)
    expect(sanitizeInsightsSettings(undefined)).toEqual(
      DEFAULT_INSIGHTS_SETTINGS
    )
    expect(sanitizeInsightsSettings('x' as unknown as null)).toEqual(
      DEFAULT_INSIGHTS_SETTINGS
    )
  })

  it('coerces partial / invalid fields to defaults', () => {
    expect(
      sanitizeInsightsSettings({
        model: '   ',
        promptStyle: 'weird',
        enrich: 'yes',
        window: '99 YEAR',
      })
    ).toEqual(DEFAULT_INSIGHTS_SETTINGS)
  })

  it('keeps valid fields', () => {
    const s = sanitizeInsightsSettings({
      model: 'anyrouter:google/gemma-4-26b-a4b-it',
      promptStyle: 'detailed',
      enrich: false,
      window: '24 HOUR',
    })
    expect(s).toEqual({
      model: 'anyrouter:google/gemma-4-26b-a4b-it',
      promptStyle: 'detailed',
      enrich: false,
      window: '24 HOUR',
    })
  })

  it('trims a model string and treats empty as null (server default)', () => {
    expect(sanitizeInsightsSettings({ model: '  x:y  ' }).model).toBe('x:y')
    expect(sanitizeInsightsSettings({ model: '' }).model).toBeNull()
  })

  it('coerces string booleans for enrich (query-param sourced)', () => {
    expect(sanitizeInsightsSettings({ enrich: 'false' }).enrich).toBe(false)
    expect(sanitizeInsightsSettings({ enrich: 'true' }).enrich).toBe(true)
    // Unrecognized strings fall back to the default.
    expect(sanitizeInsightsSettings({ enrich: 'maybe' }).enrich).toBe(
      DEFAULT_INSIGHTS_SETTINGS.enrich
    )
  })

  it('never returns the shared default object by reference', () => {
    const a = sanitizeInsightsSettings(null)
    expect(a).toEqual(DEFAULT_INSIGHTS_SETTINGS)
    expect(a).not.toBe(DEFAULT_INSIGHTS_SETTINGS)
  })
})

describe('isInsightWindow', () => {
  it('accepts known windows only', () => {
    expect(isInsightWindow('6 HOUR')).toBe(true)
    expect(isInsightWindow('7 DAY')).toBe(true)
    expect(isInsightWindow('1 MONTH')).toBe(false)
    expect(isInsightWindow(null)).toBe(false)
  })
})

describe('generateParamsFromSettings', () => {
  it('omits defaults and host is always present', () => {
    const params = generateParamsFromSettings(0, DEFAULT_INSIGHTS_SETTINGS)
    expect(params).toBe('host=0')
  })

  it('includes model + promptStyle when enrichment is on', () => {
    const params = generateParamsFromSettings(2, {
      model: 'openrouter:qwen/qwen3-coder:free',
      promptStyle: 'detailed',
      enrich: true,
      window: '6 HOUR',
    })
    const parsed = new URLSearchParams(params)
    expect(parsed.get('host')).toBe('2')
    expect(parsed.get('model')).toBe('openrouter:qwen/qwen3-coder:free')
    expect(parsed.get('promptStyle')).toBe('detailed')
    expect(parsed.get('enrich')).toBeNull()
  })

  it('sends enrich=false and drops model/style when enrichment is off', () => {
    const params = generateParamsFromSettings(1, {
      model: 'openrouter:qwen/qwen3-coder:free',
      promptStyle: 'detailed',
      enrich: false,
      window: '6 HOUR',
    })
    const parsed = new URLSearchParams(params)
    expect(parsed.get('enrich')).toBe('false')
    expect(parsed.get('model')).toBeNull()
    expect(parsed.get('promptStyle')).toBeNull()
  })
})

describe('resolveInsightModel (server-side validation)', () => {
  const KEY = 'OPENROUTER_API_KEY'
  // Read from the registry rather than hard-coding a literal: a model id is
  // only "known" while the curated floor still carries it, and OpenRouter
  // delists models — a pinned id made this test fail the moment the floor was
  // corrected against the provider's live catalog. Skips the auto-routers
  // (`openrouter/free`, `openrouter/auto`), which resolve at request time
  // rather than naming a concrete model.
  const KNOWN_OPENROUTER_MODEL = getModelRegistry().find(
    (entry) =>
      (entry.providers ?? []).includes('openrouter') &&
      !/^openrouter\//.test(entry.id)
  )?.id
  if (!KNOWN_OPENROUTER_MODEL)
    throw new Error('no OpenRouter model in registry')
  let prev: string | undefined

  beforeEach(() => {
    prev = process.env[KEY]
  })
  afterEach(() => {
    if (prev === undefined) delete process.env[KEY]
    else process.env[KEY] = prev
  })

  it('returns undefined for empty / malformed ids', () => {
    expect(resolveInsightModel(undefined)).toBeUndefined()
    expect(resolveInsightModel('')).toBeUndefined()
    expect(resolveInsightModel('no-colon')).toBeUndefined()
    expect(resolveInsightModel(':leading')).toBeUndefined()
  })

  it('accepts a known model when its provider key is configured', () => {
    process.env[KEY] = 'sk-test'
    expect(resolveInsightModel(`openrouter:${KNOWN_OPENROUTER_MODEL}`)).toBe(
      `openrouter:${KNOWN_OPENROUTER_MODEL}`
    )
  })

  it('rejects a known model when the provider key is missing', () => {
    delete process.env[KEY]
    delete process.env.LLM_API_KEY
    expect(
      resolveInsightModel(`openrouter:${KNOWN_OPENROUTER_MODEL}`)
    ).toBeUndefined()
  })

  it('rejects a model the registry no longer carries', () => {
    // A model can be delisted upstream while it is still hard-coded here. It
    // must resolve to the deployment default rather than being accepted and
    // then failing at the provider.
    process.env[KEY] = 'sk-test'
    expect(
      resolveInsightModel('openrouter:qwen/qwen3-coder:free')
    ).toBeUndefined()
  })

  it('rejects an unknown model id even with a configured provider', () => {
    process.env[KEY] = 'sk-test'
    expect(
      resolveInsightModel('openrouter:totally/made-up-model')
    ).toBeUndefined()
  })
})
