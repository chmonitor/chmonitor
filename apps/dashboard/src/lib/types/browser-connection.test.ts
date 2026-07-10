import { describe, expect, it } from 'bun:test'
import {
  type BrowserConnection,
  nextBrowserConnectionHostId,
} from './browser-connection'

const conn = (hostId: number): Pick<BrowserConnection, 'hostId'> => ({ hostId })

describe('nextBrowserConnectionHostId', () => {
  it('returns -1 for an empty list (never collides with env host 0)', () => {
    expect(nextBrowserConnectionHostId([])).toBe(-1)
  })

  it('returns one below the smallest existing negative hostId', () => {
    expect(nextBrowserConnectionHostId([conn(-1), conn(-2)])).toBe(-3)
  })

  it('ignores gaps and always goes below the minimum', () => {
    expect(nextBrowserConnectionHostId([conn(-1), conn(-5)])).toBe(-6)
  })

  it('never returns 0 (the placeholder that routed callers to the first env host)', () => {
    expect(nextBrowserConnectionHostId([conn(-1)])).not.toBe(0)
    expect(nextBrowserConnectionHostId([])).not.toBe(0)
  })
})
