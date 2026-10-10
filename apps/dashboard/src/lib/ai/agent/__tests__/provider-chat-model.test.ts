import { resolveEnvAgentModel } from '../provider-chat-model'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

const KEYS = [
  'LLM_MODEL',
  'LLM_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'ANYROUTER_API_KEY',
] as const

describe('resolveEnvAgentModel', () => {
  const saved: Record<string, string | undefined> = {}
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    warn.mockRestore()
  })

  test('keeps LLM_MODEL when its provider is configured', () => {
    process.env.NVIDIA_API_KEY = 'nv'
    process.env.LLM_MODEL = 'nvidia:nvidia/llama-3.1-nemotron-70b-instruct'
    expect(resolveEnvAgentModel()).toBe(
      'nvidia:nvidia/llama-3.1-nemotron-70b-instruct'
    )
    expect(warn).not.toHaveBeenCalled()
  })

  test('falls back to the auto default once, with a warning, when the provider has no key', () => {
    process.env.NVIDIA_API_KEY = 'nv'
    process.env.LLM_MODEL = 'anyrouter:google/gemma-4-26b-a4b-it'
    expect(resolveEnvAgentModel()).toBe(
      'nvidia:nvidia/nemotron-3-super-120b-a12b'
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('uses the auto default when LLM_MODEL is unset', () => {
    process.env.OPENROUTER_API_KEY = 'or'
    expect(resolveEnvAgentModel()).toBe('openrouter/free')
    expect(warn).not.toHaveBeenCalled()
  })
})
