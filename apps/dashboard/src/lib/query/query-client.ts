import { keepPreviousData, QueryClient } from '@tanstack/react-query'

/**
 * Build the app-wide TanStack QueryClient with our default query options.
 *
 * Extracted from provider.tsx (which wires the returned client into
 * PersistQueryClientProvider) so these defaults can be unit-tested without
 * pulling the React / persister / Clerk module graph into the test —
 * see __tests__/provider.test.tsx.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Treat cached data as fresh for 30s so quick back-and-forth
        // navigation between pages doesn't refetch at all — the previously
        // rendered result stays on screen instead of dropping to a skeleton.
        // This is only the DEFAULT: live views set a shorter per-query
        // staleTime (the chart/table hooks derive it from their
        // refreshInterval), and polling is driven by refetchInterval — which
        // fires independently of staleTime — so live pages keep updating. The
        // manual refresh button (swr:revalidate handler in provider.tsx)
        // invalidates queries, which also bypasses staleTime.
        staleTime: 30_000,

        // Keep the previous/cached data visible while a query refetches or its
        // key changes, instead of dropping to a pending state. Equivalent to
        // SWR's keepPreviousData, applied globally so pages using the default
        // client options (direct useQuery callers) get smooth in-place
        // transitions; the chart/table hooks already set their own
        // placeholderData and are unaffected. NOTE: this does not change
        // unmount/remount revisits — those already render synchronously from
        // the gcTime-retained cache — it only smooths in-place key changes.
        placeholderData: keepPreviousData,

        // Keep inactive (unmounted) query data in cache for 30 min before
        // garbage-collecting it. Orthogonal to staleTime: this does NOT
        // affect freshness — data still revalidates per staleTime — it only
        // controls how long a cached result survives after its last consumer
        // unmounts. A monitoring dashboard hops between pages constantly;
        // with the 5 min default, returning to a page after the GC window
        // shows a loading skeleton. 30 min lets the user navigate back to an
        // instant stale-while-revalidate render (cached data shown, refetch
        // in background) instead of a blank skeleton. (TanStack Query
        // default gcTime is 5 min.)
        //
        // gcTime also bounds what survives a persist round-trip: only queries
        // whose gcTime has not elapsed are restored from localStorage on load.
        gcTime: 30 * 60_000,

        // SWR revalidateOnFocus: false
        // Don't refetch when the browser tab regains focus.
        refetchOnWindowFocus: false,

        // SWR errorRetryCount: 3
        // Retry failed queries up to 3 times before surfacing the error.
        retry: 3,

        // SWR onErrorRetry uses exponential backoff starting at 1 s (errorRetryInterval: 1000),
        // doubling each attempt and capped at 30 s.
        // attempt index is 0-based; match SWR's 2^n * 1000 formula.
        retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),

        // SWR sets no global refreshInterval — polling is opt-in per query.
        // TanStack Query default (false) matches: no background refetch unless
        // the caller passes refetchInterval explicitly.
        refetchInterval: false,
      },
    },
  })
}
