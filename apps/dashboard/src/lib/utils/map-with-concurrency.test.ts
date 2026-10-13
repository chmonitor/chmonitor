import { mapWithConcurrency } from './map-with-concurrency'
import { describe, expect, test } from 'bun:test'

describe('mapWithConcurrency', () => {
  test('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0
    let max = 0
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 6], 2, async (n) => {
      inFlight += 1
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight -= 1
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 60])
    expect(max).toBe(2)
  })

  test('handles empty input', async () => {
    expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([])
  })
})
