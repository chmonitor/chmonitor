import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { retryPersistOnQuotaOverflow } from './persist-retry'
import { createQueryClient } from './query-client'
import { useEffect, useState } from 'react'
import { USER_CONNECTIONS_QUERY_PREFIX } from '@/lib/hooks/use-user-connections'
import { USER_SETTINGS_QUERY_KEY } from '@/lib/hooks/use-user-settings'

/** Max concurrent invalidations per refresh tick. */
export const REFRESH_BATCH_SIZE = 6

/** Pause between refresh batches so the Worker/ClickHouse burst stays bounded. */
export const REFRESH_BATCH_DELAY_MS = 50

/**
 * Invalidate currently-active queries in chunks instead of one
 * `invalidateQueries({ type: 'active' })` fan-out.
 */
export async function invalidateActiveQueriesInBatches(
  queryClient: QueryClient,
  options?: { batchSize?: number; delayMs?: number }
): Promise<void> {
  const batchSize = options?.batchSize ?? REFRESH_BATCH_SIZE
  const delayMs = options?.delayMs ?? REFRESH_BATCH_DELAY_MS
  const active = queryClient.getQueryCache().findAll({ type: 'active' })

  for (let i = 0; i < active.length; i += batchSize) {
    const batch = active.slice(i, i + batchSize)
    await Promise.all(
      batch.map((query) =>
        queryClient.invalidateQueries({
          queryKey: query.queryKey,
          exact: true,
        })
      )
    )
    if (i + batchSize < active.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

interface QueryProviderProps {
  children: React.ReactNode
}

/**
 * Queries that are a *view* of some other client-side store rather than of
 * server state, and so must never be written into the persisted cache.
 *
 * These entries already have an authoritative home in localStorage under their
 * own key, with their own expiry rules. Persisting them too would create a
 * second copy governed by this cache's 24h maxAge instead — and because such
 * queries are configured with `staleTime: Infinity` + `refetchOnMount: false`
 * (there is no server to revalidate against), a rehydrated copy would win
 * permanently and the real store would never be re-read. `user-settings`
 * mirrors `clickhouse-monitor-user-settings`; keeping it out of here means the
 * query function re-reads that key once per load, so it stays the single source
 * of truth.
 */
const NEVER_PERSIST_QUERY_KEYS = new Set<string>([
  String(USER_SETTINGS_QUERY_KEY[0]),
])

/**
 * Decide whether a query may be written to the persisted cache. Exported so the
 * exclusions can be tested without rendering the provider.
 */
/**
 * PeerDB `/mirrors/status`, batches, logs, and per-table counts are large
 * (hundreds of QRep partitions). Persisting them blows the ~5 MB localStorage
 * budget and slows first paint. Compact KPI numbers live in
 * `chm-peerdb-metrics-v1` instead; list/peers/graph still persist here.
 */
const BULKY_PEERDB_PATHS = new Set([
  '/mirrors/status',
  '/mirrors/cdc/batches',
  '/mirrors/logs',
])

function isBulkyPeerDBQuery(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== 'peerdb') return false
  const path = String(queryKey[1] ?? '')
  if (BULKY_PEERDB_PATHS.has(path)) return true
  return (
    path.startsWith('/mirrors/cdc/table_total_counts/') ||
    path.startsWith('/mirrors/cdc/initial_load/')
  )
}

export function shouldDehydrateQuery(query: {
  state: { status: string }
  queryKey: readonly unknown[]
}): boolean {
  // Only persist queries that actually succeeded — never cache a
  // pending/errored state to disk (it would rehydrate as a stuck
  // loading or error on next load).
  if (query.state.status !== 'success') return false
  // Never persist per-user server connections — would leak across accounts.
  if (query.queryKey[0] === USER_CONNECTIONS_QUERY_PREFIX) return false
  if (NEVER_PERSIST_QUERY_KEYS.has(String(query.queryKey[0]))) return false
  if (isBulkyPeerDBQuery(query.queryKey)) return false
  return true
}

// Persisted cache settings — see PersistQueryClientProvider below.
//
// localStorage holds ~5 MB per origin. The monitoring dashboard's query
// results (a few rows of system-table metrics per page) are tiny, so the cache
// fits comfortably. Throttle writes so a burst of background refetches doesn't
// serialize the whole cache to disk on every tick.
const PERSIST_KEY = 'chm-tsr-query-cache'
const PERSIST_THROTTLE_MS = 1_000

// Drop the persisted cache after a day so a user returning much later doesn't
// flash stale metrics before the background refetch lands.
const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000

// Invalidate the entire persisted cache on every deploy. A new build can change
// query shapes (columns, version-gated SQL), so rehydrating a previous build's
// data could render against a mismatched schema. The git SHA is inlined at
// build time (see vite.config.ts CLIENT_ENV); 'dev' covers local builds.
const PERSIST_BUSTER = import.meta.env.VITE_GIT_SHA || 'dev'

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(createQueryClient)

  // localStorage only exists in the browser. Keep the first client render
  // identical to SSR, then enable persisted query cache after hydration.
  const [persister, setPersister] = useState<ReturnType<
    typeof createSyncStoragePersister
  > | null>(null)

  useEffect(() => {
    try {
      setPersister(
        createSyncStoragePersister({
          storage: window.localStorage,
          key: PERSIST_KEY,
          throttleTime: PERSIST_THROTTLE_MS,
          retry: retryPersistOnQuotaOverflow,
        })
      )
    } catch {
      setPersister(null)
    }
  }, [])

  // Listen for the custom "swr:revalidate" event to trigger TanStack Query revalidations.
  // This supports the manual refresh button, auto-refresh countdown, and hotkeys.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleRevalidate = () => {
      void invalidateActiveQueriesInBatches(queryClient).catch((err) => {
        console.error('[QueryProvider] batched refresh invalidate failed', err)
      })
    }

    window.addEventListener('swr:revalidate', handleRevalidate)
    return () => {
      window.removeEventListener('swr:revalidate', handleRevalidate)
    }
  }, [queryClient])

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
