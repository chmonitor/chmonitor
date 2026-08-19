import { keepPreviousData, QueryClient } from '@tanstack/react-query'

import {
  invalidateActiveQueriesInBatches,
  REFRESH_BATCH_SIZE,
  shouldDehydrateQuery,
} from '../provider'
import { createQueryClient } from '../query-client'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { USER_CONNECTIONS_QUERY_PREFIX } from '@/lib/hooks/use-user-connections'
import { USER_SETTINGS_QUERY_KEY } from '@/lib/hooks/use-user-settings'

describe('invalidateActiveQueriesInBatches', () => {
  let queryClient: QueryClient
  let invalidateSpy: ReturnType<typeof spyOn>
  const unsubs: Array<() => void> = []

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    invalidateSpy = spyOn(queryClient, 'invalidateQueries')
  })

  afterEach(() => {
    for (const unsub of unsubs) unsub()
    unsubs.length = 0
    invalidateSpy.mockRestore()
    queryClient.clear()
  })

  async function seedActiveQueries(count: number) {
    const { QueryObserver } = await import('@tanstack/react-query')
    for (let i = 0; i < count; i++) {
      const key = ['refresh-test', i] as const
      queryClient.setQueryData(key, i)
      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: async () => i,
        staleTime: Number.POSITIVE_INFINITY,
      })
      unsubs.push(observer.subscribe(() => {}))
    }
  }

  it('invalidates each active query by exact key, never type:"active"', async () => {
    await seedActiveQueries(20)

    await invalidateActiveQueriesInBatches(queryClient, {
      batchSize: REFRESH_BATCH_SIZE,
      delayMs: 0,
    })

    const calls = invalidateSpy.mock.calls.map((c) => c[0])
    expect(calls.some((arg) => arg && arg.type === 'active')).toBe(false)
    expect(invalidateSpy).toHaveBeenCalledTimes(20)

    for (let i = 0; i < 20; i++) {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['refresh-test', i],
        exact: true,
      })
    }

    const firstBatchKeys = calls.slice(0, REFRESH_BATCH_SIZE).map((arg) => {
      const key = arg?.queryKey as readonly unknown[]
      return key[1]
    })
    expect(firstBatchKeys).toEqual([0, 1, 2, 3, 4, 5])
    expect(calls.length).toBe(20)
  })

  it('does not call invalidateQueries before the batch helper runs', () => {
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

describe('shouldDehydrateQuery persistence exclusions', () => {
  const q = (key: readonly unknown[], status = 'success') => ({
    state: { status },
    queryKey: key,
  })

  it('persists ordinary successful server-state queries', () => {
    expect(shouldDehydrateQuery(q(['/api/v1/charts/query-count']))).toBe(true)
  })

  it('never persists pending or errored queries', () => {
    expect(shouldDehydrateQuery(q(['/api/v1/hosts'], 'pending'))).toBe(false)
    expect(shouldDehydrateQuery(q(['/api/v1/hosts'], 'error'))).toBe(false)
  })

  it('never persists per-user connections, which would leak across accounts', () => {
    expect(shouldDehydrateQuery(q([USER_CONNECTIONS_QUERY_PREFIX, 0]))).toBe(
      false
    )
  })

  // user-settings is a *view* of the `clickhouse-monitor-user-settings`
  // localStorage key, not of server state. It is configured with
  // staleTime: Infinity + refetchOnMount: false because there is nothing to
  // revalidate against — so if a copy were persisted here it would rehydrate
  // and win permanently, and the real store would never be read again. Keeping
  // it out of the persisted cache is what preserves the single source of truth.
  it('never persists user-settings, so localStorage stays authoritative', () => {
    expect(shouldDehydrateQuery(q(USER_SETTINGS_QUERY_KEY))).toBe(false)
  })
})
