import type { QueryClient } from '@tanstack/react-query'

import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete'

import {
  completeSql,
  type SqlColumn,
  type SqlCompletionResult,
  type SqlSchema,
  type TableRef,
} from '@/lib/sql-completion/complete'
import { apiFetch } from '@/lib/swr/api-fetch'

// Schema changes rarely; one fetch per host per 10 minutes is plenty.
const SCHEMA_STALE_TIME = 10 * 60 * 1000
// How long a completion waits for lazily loaded tables/columns before showing
// what it already has. Typing is never blocked: CodeMirror runs async sources
// off the input path and drops a result the user has typed past.
const LOAD_WAIT_MS = 1_500

const KEY = 'sql-completion'

async function getRows<T>(url: string, init?: RequestInit): Promise<T[]> {
  const res = await apiFetch(url, init)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const json = (await res.json()) as { data?: T[] }
  return json.data ?? []
}

function fetchDatabases(qc: QueryClient, hostId: number) {
  return qc.fetchQuery({
    queryKey: [KEY, hostId, 'databases'],
    queryFn: async () =>
      (
        await getRows<{ name: string }>(
          `/api/v1/explorer/databases?hostId=${hostId}`
        )
      ).map((r) => r.name),
    staleTime: SCHEMA_STALE_TIME,
  })
}

function fetchFunctions(qc: QueryClient, hostId: number) {
  return qc.fetchQuery({
    queryKey: [KEY, hostId, 'functions'],
    queryFn: async () =>
      (
        await getRows<{ name: string }>('/api/v1/explorer/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            sql: 'SELECT name FROM system.functions ORDER BY name',
          }),
        })
      ).map((r) => r.name),
    staleTime: SCHEMA_STALE_TIME,
  })
}

function fetchTables(qc: QueryClient, hostId: number, database: string) {
  return qc.fetchQuery({
    queryKey: [KEY, hostId, 'tables', database],
    queryFn: async () =>
      (
        await getRows<{ name: string }>(
          `/api/v1/explorer/tables?hostId=${hostId}&database=${encodeURIComponent(database)}`
        )
      ).map((r) => r.name),
    staleTime: SCHEMA_STALE_TIME,
  })
}

function fetchColumns(qc: QueryClient, hostId: number, ref: TableRef) {
  return qc.fetchQuery({
    queryKey: [KEY, hostId, 'columns', ref.database, ref.table],
    queryFn: async () =>
      (
        await getRows<SqlColumn>(
          `/api/v1/explorer/columns?hostId=${hostId}&database=${encodeURIComponent(ref.database)}&table=${encodeURIComponent(ref.table)}`
        )
      ).map(({ name, type }) => ({ name, type })),
    staleTime: SCHEMA_STALE_TIME,
  })
}

/** Snapshot of everything already cached for this host. */
export function readSchema(qc: QueryClient, hostId: number): SqlSchema {
  const schema: SqlSchema = {
    databases: [],
    tables: {},
    columns: {},
    functions: null,
  }
  for (const [key, data] of qc.getQueriesData({ queryKey: [KEY, hostId] })) {
    if (!data) continue
    const [, , kind, db, table] = key as [
      string,
      number,
      string,
      string,
      string,
    ]
    if (kind === 'databases') schema.databases = data as string[]
    else if (kind === 'functions') schema.functions = data as string[]
    else if (kind === 'tables') schema.tables[db] = data as string[]
    else if (kind === 'columns')
      schema.columns[`${db}.${table}`] = data as SqlColumn[]
  }
  return schema
}

/** Warm the cheap, always-needed parts so the first popup is complete. */
export function prefetchSqlSchema(qc: QueryClient, hostId: number): void {
  fetchDatabases(qc, hostId).catch(() => {})
  // A host without explorer-query permission keeps the static function list.
  fetchFunctions(qc, hostId).catch(() => {})
}

function loadMissing(
  qc: QueryClient,
  hostId: number,
  missing: SqlCompletionResult['missing']
): Promise<unknown> {
  return Promise.allSettled([
    ...missing.tables.map((db) => fetchTables(qc, hostId, db)),
    ...missing.columns.map((ref) => fetchColumns(qc, hostId, ref)),
  ])
}

export function createSqlCompletionSource(
  qc: QueryClient,
  hostId: number
): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const doc = ctx.state.doc.toString()
    const run = () =>
      completeSql(doc, ctx.pos, readSchema(qc, hostId), {
        explicit: ctx.explicit,
      })

    let result = run()
    if (!result) return null
    const { tables, columns } = result.missing
    if (tables.length || columns.length) {
      await Promise.race([
        loadMissing(qc, hostId, result.missing),
        new Promise((r) => setTimeout(r, LOAD_WAIT_MS)),
      ])
      if (ctx.aborted) return null
      result = run() ?? result
    }
    return {
      from: result.from,
      options: result.options,
      validFor: /^[A-Za-z0-9_$]*$/,
    }
  }
}
