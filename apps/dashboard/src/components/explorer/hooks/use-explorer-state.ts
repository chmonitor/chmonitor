import { useLocation, useNavigate } from '@tanstack/react-router'

import { useCallback, useMemo, useRef } from 'react'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { splitHref } from '@/lib/url/url-builder'

export type ExplorerTab =
  | 'overview'
  | 'data'
  | 'structure'
  | 'ddl'
  | 'indexes'
  | 'dependencies'
  | 'query'

export interface ExplorerState {
  hostId: number
  database: string | null
  table: string | null
  engine: string | null
  tab: ExplorerTab
  customQuery: string | null
}

/**
 * Exposes explorer state derived from the current URL search parameters and provides setters that update those parameters.
 *
 * The returned state mirrors the explorer's URL-driven values: `hostId`, `database`, `table`, `engine`, `tab`, and `customQuery`.
 * Setter functions modify the URL search parameters so the explorer state stays in sync with the browser address bar.
 *
 * @returns An object containing the current explorer state and setter functions:
 * - `setDatabase(database: string | null)` — set or clear the `database` parameter; clearing the database also clears `table` and `engine`.
 * - `setTable(table: string | null, engine?: string | null)` — set or clear the `table` parameter; optionally set or clear `engine`. Clearing the table also clears `engine`.
 * - `setDatabaseAndTable(database: string, table: string, engine?: string)` — set `database`, `table`, and `engine` (defaults `engine` to `null` when omitted) and clear `customQuery`.
 * - `setTab(tab: ExplorerTab)` — set the `tab` parameter.
 * - `setCustomQuery(sql: string | null)` — set or clear the encoded custom query (`q`) parameter.
 */
export function useExplorerState(): ExplorerState & {
  setDatabase: (database: string | null) => void
  setDefaultDatabase: (database: string | null) => void
  setTable: (table: string | null, engine?: string | null) => void
  setDatabaseAndTable: (
    database: string,
    table: string,
    engine?: string
  ) => void
  setTab: (tab: ExplorerTab) => void
  setCustomQuery: (sql: string | null) => void
} {
  const searchParams = useUrlSearchParams()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })

  const state = useMemo<ExplorerState>(() => {
    const hostParam = searchParams.get('host')
    const hostId = hostParam !== null ? Number(hostParam) : 0

    const q = searchParams.get('q')
    let customQuery: string | null = null
    if (q) {
      try {
        customQuery = decodeURIComponent(atob(q))
      } catch {
        customQuery = null
      }
    }

    return {
      hostId: Number.isNaN(hostId) ? 0 : hostId,
      database: searchParams.get('database'),
      table: searchParams.get('table'),
      engine: searchParams.get('engine'),
      tab: (searchParams.get('tab') as ExplorerTab) || 'overview',
      customQuery,
    }
  }, [searchParams])

  // Use a ref for searchParams so updateParams doesn't depend on it.
  // This prevents ALL setter callbacks from being recreated on every URL change,
  // which was causing the entire database tree to re-render on each navigation.
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams

  const updateParams = useCallback(
    (updates: Partial<Omit<ExplorerState, 'hostId'>>) => {
      const params = new URLSearchParams(searchParamsRef.current.toString())

      if (updates.database !== undefined) {
        if (updates.database === null) {
          params.delete('database')
          params.delete('table') // Clear table when database is cleared
          params.delete('engine')
        } else {
          params.set('database', updates.database)
        }
      }

      if (updates.table !== undefined) {
        if (updates.table === null) {
          params.delete('table')
          params.delete('engine')
        } else {
          params.set('table', updates.table)
        }
      }

      if (updates.engine !== undefined) {
        if (updates.engine === null) {
          params.delete('engine')
        } else {
          params.set('engine', updates.engine)
        }
      }

      if (updates.tab !== undefined) {
        params.set('tab', updates.tab)
      }

      if (updates.customQuery !== undefined) {
        if (updates.customQuery === null) {
          params.delete('q')
        } else {
          params.set('q', btoa(encodeURIComponent(updates.customQuery)))
        }
      }

      navigate(splitHref(`${pathname}?${params.toString()}`))
    },
    [pathname, navigate]
  )

  const setDatabase = useCallback(
    (database: string | null) => {
      updateParams({ database, table: null }) // Clear table when changing database
    },
    [updateParams]
  )

  // Set the default database WITHOUT clearing the selected table. Used by the
  // SQL console's database picker, where switching the default DB for
  // unqualified table names should not blow away the current query context.
  const setDefaultDatabase = useCallback(
    (database: string | null) => {
      updateParams({ database })
    },
    [updateParams]
  )

  const setTable = useCallback(
    (table: string | null, engine?: string | null) => {
      updateParams({ table, engine: engine ?? null })
    },
    [updateParams]
  )

  const setDatabaseAndTable = useCallback(
    (database: string, table: string, engine?: string) => {
      updateParams({
        database,
        table,
        engine: engine ?? null,
        // Preserve the currently selected tab when switching tables
        customQuery: null, // Clear stale query when switching tables
      })
    },
    [updateParams]
  )

  const setTab = useCallback(
    (tab: ExplorerTab) => {
      updateParams({ tab })
    },
    [updateParams]
  )

  const setCustomQuery = useCallback(
    (sql: string | null) => {
      updateParams({ customQuery: sql })
    },
    [updateParams]
  )

  return {
    ...state,
    setDatabase,
    setDefaultDatabase,
    setTable,
    setDatabaseAndTable,
    setTab,
    setCustomQuery,
  }
}
