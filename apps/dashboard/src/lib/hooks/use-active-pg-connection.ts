/**
 * Resolves the ACTIVE Postgres source from the `?pg=<connectionId>` search
 * param (issue #2450). This is the Postgres analog of `?host=<n>` — a SEPARATE
 * routing dimension so a Postgres source is never overloaded onto a hostId.
 * When a valid `?pg=` is present, the active engine is `'postgres'`
 * and the nav menu swaps to Postgres pages (decision 4).
 *
 * Fail-closed: without the feature flag / a resolvable connection / a router,
 * the engine is {@link DEFAULT_SOURCE_ENGINE}, so the default menu is
 * byte-for-byte unchanged. Settings (and tests that open it) must not crash
 * when no RouterProvider is mounted.
 */

import type { AnyRouter } from '@tanstack/react-router'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'

import { DEFAULT_SOURCE_ENGINE, type SourceEngine } from '@chm/types'
import { useMemo } from 'react'
import {
  type PgConnectionInfo,
  usePgConnections,
} from '@/lib/hooks/use-pg-connections'

/** The `?pg=` query-param name carrying the active Postgres connection id. */
export const PG_HOST_PARAM = 'pg'

let fallbackRouter: AnyRouter | undefined

function getFallbackRouter(): AnyRouter {
  fallbackRouter ??= createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  }) as unknown as AnyRouter
  return fallbackRouter
}

/**
 * Search params for the active host. Empty when there is no RouterProvider
 * so SettingsForm can resolve the engine in isolation (nav-settings-button
 * tests, prerender) instead of crashing.
 */
function useHostSearchParams(): URLSearchParams {
  const router = useRouter({ warn: false }) as AnyRouter | null
  const searchStr = useRouterState({
    router: router ?? getFallbackRouter(),
    select: (state) => state.location.searchStr,
  })
  return useMemo(
    () => new URLSearchParams(typeof searchStr === 'string' ? searchStr : ''),
    [searchStr]
  )
}

/** The active Postgres connection, or `null` when no Postgres source is active. */
export function useActivePgConnection(): PgConnectionInfo | null {
  const searchParams = useHostSearchParams()
  const pgId = searchParams.get(PG_HOST_PARAM)
  const { getByConnectionId } = usePgConnections()
  if (!pgId) return null
  return getByConnectionId(pgId) ?? null
}

/**
 * The active host's source engine, threaded into `getVisibleMenuItems` to swap
 * the nav menu. `'postgres'` only when a valid `?pg=` is active; otherwise
 * {@link DEFAULT_SOURCE_ENGINE} (default-engine hosts keep today's exact menu).
 */
export function useActiveHostEngine(): SourceEngine {
  return useActivePgConnection() ? 'postgres' : DEFAULT_SOURCE_ENGINE
}
