import {
  getMemoryCache,
  getQueryCache,
  resetMemoryCacheInstance,
  resetQueryCacheInstance,
} from './index'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'

// Regression coverage for issue #2505: resetting a cache singleton must
// dispose the outgoing adapter (stopping its cleanup `setInterval`) instead
// of just nulling the reference and orphaning the timer.
describe('cache singleton reset — dispose on reset', () => {
  beforeEach(() => {
    resetQueryCacheInstance()
    resetMemoryCacheInstance()
  })

  it('resetQueryCacheInstance disposes the outgoing adapter before nulling it', () => {
    const instance = getQueryCache()
    const disposeSpy = spyOn(instance, 'dispose')

    resetQueryCacheInstance()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('resetMemoryCacheInstance disposes the outgoing adapter before nulling it', () => {
    const instance = getMemoryCache()
    const disposeSpy = spyOn(instance, 'dispose')

    resetMemoryCacheInstance()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('getQueryCache constructs a fresh adapter after a reset', () => {
    const first = getQueryCache()
    resetQueryCacheInstance()
    const second = getQueryCache()

    expect(second).not.toBe(first)
  })

  it('is a no-op (does not throw) when no instance exists yet', () => {
    expect(() => resetQueryCacheInstance()).not.toThrow()
    expect(() => resetMemoryCacheInstance()).not.toThrow()
  })
})
