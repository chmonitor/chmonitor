import {
  isMuted,
  loadMutes,
  MUTE_STORAGE_KEY,
  muteFingerprint,
  saveMutes,
  unmuteFingerprint,
} from './log-mute'
import { describe, expect, test } from 'bun:test'

const HOUR = 3_600_000

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(MUTE_STORAGE_KEY, initial)
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
}

describe('mute expiry', () => {
  test('a timed mute hides the pattern until it expires', () => {
    const m = muteFingerprint({}, 'fp', HOUR, 1000)
    expect(isMuted(m, 'fp', 1000 + HOUR - 1)).toBe(true)
    expect(isMuted(m, 'fp', 1000 + HOUR)).toBe(false)
  })

  test('until-unmuted never expires and unmute removes it', () => {
    const m = muteFingerprint({}, 'fp', null, 1000)
    expect(isMuted(m, 'fp', 1000 + 365 * 24 * HOUR)).toBe(true)
    expect(isMuted(unmuteFingerprint(m, 'fp'), 'fp')).toBe(false)
  })

  test('unrelated and prototype keys are not muted', () => {
    const m = muteFingerprint({}, 'fp', null)
    expect(isMuted(m, 'other')).toBe(false)
    expect(isMuted(m, 'toString')).toBe(false)
  })

  test('muting prunes already expired entries', () => {
    const old = muteFingerprint({}, 'old', HOUR, 0)
    const m = muteFingerprint(old, 'new', HOUR, 2 * HOUR)
    expect(Object.keys(m)).toEqual(['new'])
  })
})

describe('storage', () => {
  test('round trips and drops expired entries on load', () => {
    const s = memoryStorage()
    const now = 10_000
    saveMutes({ live: now + HOUR, dead: now - 1, forever: null }, s)
    expect(loadMutes(now, s)).toEqual({ live: now + HOUR, forever: null })
  })

  test('throwing storage degrades to empty and save reports failure', () => {
    expect(loadMutes(0, throwing)).toEqual({})
    expect(saveMutes({ a: null }, throwing)).toBe(false)
    expect(loadMutes(0, null)).toEqual({})
    expect(saveMutes({ a: null }, null)).toBe(false)
  })

  test('corrupt or wrongly shaped data is ignored', () => {
    expect(loadMutes(0, memoryStorage('{not json'))).toEqual({})
    expect(loadMutes(0, memoryStorage('[1,2]'))).toEqual({})
    expect(loadMutes(0, memoryStorage('{"a":"x","b":null}'))).toEqual({
      b: null,
    })
  })
})
