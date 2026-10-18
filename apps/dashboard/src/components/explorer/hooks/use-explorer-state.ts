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
          params.delete('table')
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
      updateParams({ database, table: null })
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
        customQuery: null,
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
