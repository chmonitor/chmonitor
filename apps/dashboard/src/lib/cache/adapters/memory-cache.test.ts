/**
 * Regression coverage for #2954: `MemoryCacheAdapter` evicted strictly
 * FIFO — reads never re-inserted a hit, so eviction (which walks `keys()`
 * from the front) removed the oldest-written entry even if it was the
 * hottest one just read a moment ago. Fixed by delete+set on hit to move the
 * entry to the tail of the Map's insertion order, making eviction LRU.
 */

import type { CacheOptions } from '../types'

import { MemoryCacheAdapter } from './memory-cache'
import { afterEach, describe, expect, test } from 'bun:test'

const keyed = (name: string): CacheOptions => ({ key: [name] })

describe('MemoryCacheAdapter', () => {
  let adapter: MemoryCacheAdapter | undefined

  afterEach(() => {
    adapter?.dispose()
    adapter = undefined
  })

  test('caches the fn result for a repeated key (no recompute on hit)', async () => {
    adapter = new MemoryCacheAdapter()
    let calls = 0
    const fn = async () => {
      calls++
      return 'value'
    }

    expect(await adapter.wrap(fn, keyed('a'))).toBe('value')
    expect(await adapter.wrap(fn, keyed('a'))).toBe('value')
    expect(calls).toBe(1)
  })

  test('a hot key survives eviction after being touched (LRU, not FIFO)', async () => {
    adapter = new MemoryCacheAdapter(3)
    const makeFn = (v: string) => async () => v

    // Fill the cache to its max size: insertion order [a, b, c].
    await adapter.wrap(makeFn('a'), keyed('a'))
    await adapter.wrap(makeFn('b'), keyed('b'))
    await adapter.wrap(makeFn('c'), keyed('c'))

    // Touch "a" again — a plain FIFO cache leaves insertion order untouched;
    // an LRU cache moves "a" to the tail: [b, c, a].
    let aRecomputed = 0
    await adapter.wrap(async () => {
      aRecomputed++
      return 'a-recomputed'
    }, keyed('a'))
    expect(aRecomputed).toBe(0) // still a hit, not recomputed

    // Writing a 4th distinct key pushes the cache over maxSize by one,
    // evicting exactly one entry from the front.
    await adapter.wrap(makeFn('d'), keyed('d'))

    // "b" was never touched after being written first among the survivors —
    // it is the least-recently-used entry and gets evicted.
    let bRecomputed = 0
    await adapter.wrap(async () => {
      bRecomputed++
      return 'b-recomputed'
    }, keyed('b'))
    expect(bRecomputed).toBe(1) // recomputed: "b" was evicted

    // "a" was touched most recently before the eviction, so it must survive.
    let aRecomputedAfterEvict = 0
    await adapter.wrap(async () => {
      aRecomputedAfterEvict++
      return 'a-recomputed-again'
    }, keyed('a'))
    expect(aRecomputedAfterEvict).toBe(0) // still cached, not recomputed
  })
})
