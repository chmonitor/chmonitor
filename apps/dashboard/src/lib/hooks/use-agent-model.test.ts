import { parseCustomModelId } from './use-agent-model'
import { describe, expect, test } from 'bun:test'

describe('parseCustomModelId', () => {
  test('accepts a well-formed provider:model id', () => {
    expect(parseCustomModelId('openrouter:qwen/qwen3-coder')).toEqual({
      id: 'openrouter:qwen/qwen3-coder',
    })
  })

  test('trims surrounding whitespace', () => {
    expect(parseCustomModelId('  anyrouter:x-ai/grok-4.6  ')).toEqual({
      id: 'anyrouter:x-ai/grok-4.6',
    })
  })

  test('accepts ids the catalog does not list — that is the point', () => {
    // A brand-new upstream model, absent from MODEL_REGISTRY and from any
    // dynamic fetch. Restricting to the fetched list would defeat the feature.
    const result = parseCustomModelId('openrouter:acme/model-from-tomorrow')
    expect(result).toEqual({ id: 'openrouter:acme/model-from-tomorrow' })
  })

  test('keeps a trailing free-variant suffix intact', () => {
    expect(parseCustomModelId('openrouter:qwen/qwen3-coder:free')).toEqual({
      id: 'openrouter:qwen/qwen3-coder:free',
    })
  })

  test('rejects an empty value', () => {
    expect(parseCustomModelId('   ')).toEqual({ error: 'Enter a model id' })
  })

  test('rejects a bare model name with no provider', () => {
    const result = parseCustomModelId('qwen3-coder')
    expect(result).toHaveProperty('error')
  })

  test('rejects a value with no model after the provider', () => {
    expect(parseCustomModelId('openrouter:')).toHaveProperty('error')
  })

  test('rejects a value starting with the separator', () => {
    expect(parseCustomModelId(':qwen3-coder')).toHaveProperty('error')
  })

  test('rejects whitespace inside the id', () => {
    expect(parseCustomModelId('openrouter:qwen 3')).toEqual({
      error: 'Model id cannot contain spaces',
    })
  })

  test('rejects an over-long id', () => {
    expect(parseCustomModelId(`openrouter:${'a'.repeat(300)}`)).toEqual({
      error: 'Model id is too long',
    })
  })

  test('rejects a provider the server does not know', () => {
    // Guards the real failure mode: a typo'd provider would 400 on the first
    // message instead of being caught in the picker.
    expect(
      parseCustomModelId('openrouterr:qwen/qwen3-coder', [
        'openrouter',
        'anyrouter',
      ])
    ).toEqual({ error: 'Unknown provider "openrouterr"' })
  })

  test('accepts any provider when the server reported none', () => {
    // configuredProviders is empty while the models API is still loading (or
    // offline) — do not block the user on unknown state.
    expect(parseCustomModelId('nvidia:meta/llama-3.1', [])).toEqual({
      id: 'nvidia:meta/llama-3.1',
    })
  })
})
