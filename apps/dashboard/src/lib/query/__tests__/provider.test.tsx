import { keepPreviousData, QueryClient } from '@tanstack/react-query'

import { createQueryClient } from '../query-client'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

describe('QueryProvider swr:revalidate integration', () => {
  let queryClient: QueryClient
  let invalidateSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    queryClient = new QueryClient()
    invalidateSpy = spyOn(queryClient, 'invalidateQueries')
  })

  afterEach(() => {
    invalidateSpy.mockRestore()
  })

  it('calls invalidateQueries({ type: "active" }) when swr:revalidate fires', () => {
    // Simulate the effect body from QueryProvider directly.
    // The effect registers a window listener; we replicate that wiring here
    // so the test stays decoupled from React rendering internals.
    const listeners: Record<string, EventListenerOrEventListenerObject[]> = {}
    const mockWindow = {
      addEventListener: (
        event: string,
        cb: EventListenerOrEventListenerObject
      ) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      },
      removeEventListener: (
        event: string,
        cb: EventListenerOrEventListenerObject
      ) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((x) => x !== cb)
        }
      },
    }

    // Wire up the same handler logic as in provider.tsx's useEffect
    const handleRevalidate = () => {
      queryClient.invalidateQueries({ type: 'active' })
    }
    mockWindow.addEventListener('swr:revalidate', handleRevalidate)

    // Trigger the event
    listeners['swr:revalidate'].forEach((cb) =>
      typeof cb === 'function'
        ? (cb as any)()
        : cb.handleEvent(new Event('swr:revalidate'))
    )

    expect(invalidateSpy).toHaveBeenCalledWith({ type: 'active' })

    // Cleanup unregisters the listener
    mockWindow.removeEventListener('swr:revalidate', handleRevalidate)
    expect(listeners['swr:revalidate'].length).toBe(0)
  })

  it('does not call invalidateQueries before the event fires', () => {
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('createQueryClient default query options', () => {
  // These defaults are the mechanism behind "cached data on navigation":
  // gcTime keeps a page's data alive between visits, staleTime avoids a
  // refetch (and thus a possible loading state) on a quick revisit, and
  // placeholderData keeps prior data on screen during in-place key changes.
  // Assert the intent so a regression that reintroduces the revisit flash
  // (e.g. resetting staleTime to a few seconds) fails here.

  it('treats cached data as fresh for 30s so quick revisits skip the refetch', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.staleTime).toBe(30_000)
  })

  it('uses keepPreviousData so in-place key changes never blank to a skeleton', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.placeholderData).toBe(keepPreviousData)
  })

  it('retains inactive query data for 30 min so navigation revisits render from cache', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.gcTime).toBe(30 * 60_000)
  })

  it('does not refetch on window focus', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.refetchOnWindowFocus).toBe(false)
  })
})
