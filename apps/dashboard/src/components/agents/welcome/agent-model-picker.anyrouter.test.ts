/**
 * A guest's AnyRouter token only counts on an `anyrouter:` model — the server
 * drops to the guest default otherwise and the sign-in silently does nothing.
 */

import { pickGuestAnyRouterModel } from './agent-model-picker'
import { describe, expect, test } from 'bun:test'

const models = [
  { id: 'openrouter:free', provider: 'openrouter' },
  { id: 'anyrouter:claude', provider: 'anyrouter' },
  { id: 'anyrouter:gpt', provider: 'anyrouter' },
]

describe('pickGuestAnyRouterModel', () => {
  test('switches a non-AnyRouter model to the first AnyRouter one', () => {
    expect(pickGuestAnyRouterModel('openrouter:free', models)).toBe(
      'anyrouter:claude'
    )
  })

  test('keeps an AnyRouter model the user already picked', () => {
    expect(pickGuestAnyRouterModel('anyrouter:gpt', models)).toBeNull()
  })

  test('no AnyRouter model listed: keeps the current one', () => {
    expect(pickGuestAnyRouterModel('openrouter:free', [models[0]])).toBeNull()
  })
})
