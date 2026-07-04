import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { createQueryClient } from './query-client'
import { useEffect, useState } from 'react'
import { USER_CONNECTIONS_QUERY_PREFIX } from '@/lib/hooks/use-user-connections'

interface QueryProviderProps {
  children: React.ReactNode
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
      queryClient.invalidateQueries({ type: 'active' })
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
        dehydrateOptions: {
          // Only persist queries that actually succeeded — never cache a
          // pending/errored state to disk (it would rehydrate as a stuck
          // loading or error on next load).
          shouldDehydrateQuery: (query) => {
            if (query.state.status !== 'success') return false
            // Never persist per-user server connections — would leak across accounts.
            if (query.queryKey[0] === USER_CONNECTIONS_QUERY_PREFIX) {
              return false
            }
            return true
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
