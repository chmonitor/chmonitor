import { shouldAutoOpenChangelog } from './last-seen'
import { describe, expect, test } from 'bun:test'

describe('shouldAutoOpenChangelog', () => {
  test('opens once per version after an upgrade', () => {
    expect(
      shouldAutoOpenChangelog({
        appVersion: '0.3.3',
        hasUpgrade: true,
        alreadyOpenedVersion: '',
      })
    ).toBe(true)
    expect(
      shouldAutoOpenChangelog({
        appVersion: '0.3.3',
        hasUpgrade: true,
        alreadyOpenedVersion: '0.3.3',
      })
    ).toBe(false)
  })

  test('does not auto-open when there is no upgrade', () => {
    expect(
      shouldAutoOpenChangelog({
        appVersion: '0.3.3',
        hasUpgrade: false,
        alreadyOpenedVersion: '',
      })
    ).toBe(false)
  })
})
