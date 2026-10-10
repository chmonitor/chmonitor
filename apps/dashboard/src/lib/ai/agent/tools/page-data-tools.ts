/**
 * `get_page_data` — replay a dashboard page's own queries for the agent.
 *
 * Every data page in the dashboard renders table QueryConfigs and chart
 * builders. `find_reference_query` only returns their SQL; this tool runs them,
 * through the same registry + executor the page's API routes use
 * (`getTableQuery` → `executeTableConfig`, `getChartQuery` →
 * `executeChartQuery`), so versioned SQL, `filterSchema` WHERE injection, the
 * server-side row cap, and the optional-table check all apply unchanged.
 *
 * Page → sources mapping lives in `../page-data-map.ts`. Read-only.
 */

import { z } from 'zod'

import type { QueryConfig } from '@/types/query-config'

import {
  NON_DATA_PAGES,
  normalizePageKey,
  PAGE_DATA_MAP,
  type PageDataEntry,
} from '../page-data-map'
import { hostIdSchema, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

/** Default rows kept per source. */
export const PAGE_DATA_DEFAULT_LIMIT = 20
/** Hard cap on rows per source (input schema bound, re-applied in execute). */
export const PAGE_DATA_MAX_LIMIT = 200
/** Total serialized-output budget for one call. */
export const PAGE_DATA_MAX_BYTES = 16_000
/** At most this many sources run per call; the rest are named as skipped. */
export const PAGE_DATA_MAX_SOURCES = 24
/** Concurrent ClickHouse reads per call. */
const CONCURRENCY = 6

type SourceKind = 'table' | 'chart'

export interface PageDataSource {
  name: string
  kind: SourceKind
  rows: unknown[]
  rowCount: number
  truncated: boolean
  error?: string
  note?: string
}

interface ResolvedPage {
  page: string
  title: string
  configs: readonly string[]
  charts: readonly string[]
}

interface Registries {
  hasTable: (name: string) => boolean
  hasChart: (name: string) => boolean
}

/** Resolve `page` to a map entry, or to a single config/chart by name. */
function resolvePage(
  input: string,
  reg: Registries
): ResolvedPage | { nonData: string; page: string } | null {
  const key = normalizePageKey(input)
  const entry: PageDataEntry | undefined = PAGE_DATA_MAP[key]
  if (entry) return { page: key, ...entry }
  if (NON_DATA_PAGES[key]) return { page: key, nonData: NON_DATA_PAGES[key] }

  const lowered = input.trim().toLowerCase()
  for (const [route, e] of Object.entries(PAGE_DATA_MAP)) {
    if (e.title.toLowerCase() === lowered) return { page: route, ...e }
  }

  const name = input.trim()
  if (reg.hasTable(name))
    return { page: name, title: name, configs: [name], charts: [] }
  if (reg.hasChart(name))
    return { page: name, title: name, configs: [], charts: [name] }
  return null
}

/** Compact page listing, grouped by sidebar section. */
export function listPages(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [route, e] of Object.entries(PAGE_DATA_MAP)) {
    const list = out[e.section] ?? []
    list.push(`${route} — ${e.title}`)
    out[e.section] = list
  }
  return out
}

const OPERATOR_PREFIX = /^([a-zA-Z]+):/

/**
 * Turn the agent's `filters` + `lastHours` into the URL search params the
 * table registry expects. With a `filterSchema` only schema keys are accepted
 * (values become `operator:value`, plain values default to `eq:`); without
 * one, only keys the config already declares in `defaultParams` are passed.
 */
async function buildTableSearchParams(
  config: QueryConfig,
  filters: Record<string, string>,
  lastHours: number | undefined
): Promise<{ searchParams: Record<string, string>; ignored: string[] }> {
  const searchParams: Record<string, string> = {}
  const ignored: string[] = []

  if (config.filterSchema) {
    const { isFilterOperator } = await import('@/lib/filters/operators')
    const fields = config.filterSchema.fields
    for (const [key, raw] of Object.entries(filters)) {
      if (!fields.some((f) => f.key === key)) {
        ignored.push(key)
        continue
      }
      const op = raw.match(OPERATOR_PREFIX)?.[1]
      searchParams[key] = op && isFilterOperator(op) ? raw : `eq:${raw}`
    }
    const timeField = fields.find((f) => f.type === 'datetime')
    if (lastHours && timeField && !(timeField.key in searchParams)) {
      searchParams[timeField.key] = `withinHours:${lastHours}`
    }
    return { searchParams, ignored }
  }

  const declared = config.defaultParams ?? {}
  for (const [key, value] of Object.entries(filters)) {
    if (key in declared) searchParams[key] = value
    else ignored.push(key)
  }
  if (lastHours && 'last_hours' in declared && !('last_hours' in filters)) {
    searchParams.last_hours = String(lastHours)
  }
  return { searchParams, ignored }
}

function parseRows(dataJson: string | null | undefined): unknown[] {
  if (!dataJson) return []
  try {
    const parsed = JSON.parse(dataJson)
    return Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed]
  } catch {
    return []
  }
}

const errMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e ?? 'Unknown error')

/** Missing-table errors on an optional source are expected, not failures. */
function asNoteOrError(
  message: string,
  optional: boolean | undefined
): Pick<PageDataSource, 'error' | 'note'> {
  return optional
    ? { note: `Not available on this host: ${message}` }
    : { error: message }
}

function withRows(
  name: string,
  kind: SourceKind,
  all: unknown[],
  limit: number
): PageDataSource {
  return {
    name,
    kind,
    rows: all.slice(0, limit),
    rowCount: all.length,
    truncated: all.length > limit,
  }
}

async function runTableSource(
  name: string,
  hostId: number,
  filters: Record<string, string>,
  lastHours: number | undefined,
  limit: number
): Promise<PageDataSource & { ignoredFilters?: string[] }> {
  const { getTableConfig, getTableQuery } = await import(
    '@/lib/api/table-registry'
  )
  const { executeTableConfig } = await import('@/lib/api/query-executor')
  const config = getTableConfig(name)
  const empty = { name, kind: 'table' as const, rows: [], rowCount: 0 }
  if (!config)
    return { ...empty, truncated: false, error: 'Unknown query config' }

  const { searchParams, ignored } = await buildTableSearchParams(
    config,
    filters,
    lastHours
  )
  const tableQuery = getTableQuery(name, { hostId, searchParams })
  if (!tableQuery)
    return { ...empty, truncated: false, error: 'Unknown query config' }

  try {
    const { result } = await executeTableConfig(
      tableQuery.queryConfig,
      hostId,
      tableQuery.queryParams
    )
    const extra = ignored.length > 0 ? { ignoredFilters: ignored } : {}
    if (result.error) {
      return {
        ...empty,
        truncated: false,
        ...asNoteOrError(result.error.message, config.optional),
        ...extra,
      }
    }
    return {
      ...withRows(name, 'table', (result.data ?? []) as unknown[], limit),
      ...extra,
    }
  } catch (e) {
    return {
      ...empty,
      truncated: false,
      ...asNoteOrError(errMessage(e), config.optional),
    }
  }
}

async function runChartSource(
  name: string,
  hostId: number,
  filters: Record<string, string>,
  lastHours: number | undefined,
  limit: number
): Promise<PageDataSource> {
  const { getChartQuery } = await import('@/lib/api/chart-registry')
  const { executeChartQuery, executeMultiChartQuery } = await import(
    '@/lib/api/query-executor'
  )
  const empty = {
    name,
    kind: 'chart' as const,
    rows: [],
    rowCount: 0,
    truncated: false,
  }

  let built: ReturnType<typeof getChartQuery>
  try {
    built = getChartQuery(name, {
      ...(lastHours ? { lastHours } : {}),
      ...(Object.keys(filters).length > 0 ? { params: filters } : {}),
    })
  } catch (e) {
    return { ...empty, error: errMessage(e) }
  }
  if (!built) return { ...empty, error: 'Unknown chart' }

  if (built.permission) {
    const { getAppConfig } = await import('@/lib/feature-permissions/server')
    const { isFeatureAllowed } = await import(
      '@/lib/feature-permissions/shared'
    )
    if (!isFeatureAllowed(built.permission, getAppConfig())) {
      return {
        ...empty,
        note: `The "${built.permission.feature}" feature is disabled on this deployment.`,
      }
    }
  }

  try {
    if ('queries' in built) {
      const { results } = await executeMultiChartQuery(built.queries, hostId)
      const rows = results.map((r) => ({
        key: r.key,
        rows: parseRows(r.dataJson).slice(0, limit),
        ...(r.error ? { error: r.error.message } : {}),
      }))
      return { ...withRows(name, 'chart', rows, limit) }
    }

    const res = await executeChartQuery(
      name,
      built.sql ?? built.query,
      hostId,
      built.queryParams,
      {
        optional: built.optional,
        tableCheck: built.tableCheck,
        columnCheck: built.columnCheck,
        clickhouseSettings: built.clickhouseSettings,
        disableQueryCache: built.disableQueryCache,
      }
    )
    if (res.error)
      return { ...empty, ...asNoteOrError(res.error.message, built.optional) }
    return withRows(name, 'chart', parseRows(res.dataJson), limit)
  } catch (e) {
    const optional = 'queries' in built ? false : built.optional
    return { ...empty, ...asNoteOrError(errMessage(e), optional) }
  }
}

/** Run tasks with a small concurrency cap, preserving order. */
async function mapLimit<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/**
 * Shrink sources until the serialized output fits `budget`: halve the rows of
 * the largest source and mark it truncated, repeatedly.
 */
function fitToBudget(sources: PageDataSource[], budget: number): void {
  const size = () => JSON.stringify(sources).length
  let guard = 0
  while (size() > budget && guard++ < 200) {
    let biggest: PageDataSource | undefined
    let biggestSize = 0
    for (const s of sources) {
      const sz = JSON.stringify(s.rows).length
      if (sz > biggestSize) {
        biggest = s
        biggestSize = sz
      }
    }
    if (!biggest || biggest.rows.length === 0) break
    biggest.rows = biggest.rows.slice(0, Math.floor(biggest.rows.length / 2))
    biggest.truncated = true
  }
}

export function createPageDataTools(hostId: number) {
  return {
    get_page_data: dynamicTool({
      description:
        'Return the live data a dashboard page shows, by running that page\'s own table and chart queries (same SQL, version handling, and filters as the UI). Pass `page` as a route ("/merges", "/keeper/watches", "/overview?tab=storage"), a page title ("Merges"), or a single query-config / chart name ("merge-count"). Omit `page` (or pass an unknown one) to get the page list. Use this when the user asks what a page, chart, or panel shows; use dedicated tools for deeper analysis. Read-only.',
      inputSchema: z.object({
        page: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Route, page title, or query-config/chart name. Omit to list pages.'
          ),
        filters: z
          .record(z.string(), z.string().max(500))
          .optional()
          .describe(
            'Page filters, e.g. {"user": "alice"} or {"database": "eq:default"}. Keys must match the page filter fields; unknown keys are reported as ignored.'
          ),
        lastHours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .describe('Time window in hours, when the page has one.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(PAGE_DATA_MAX_LIMIT)
          .optional()
          .describe(
            `Rows per source (default ${PAGE_DATA_DEFAULT_LIMIT}, max ${PAGE_DATA_MAX_LIMIT}).`
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          page,
          filters = {},
          lastHours,
          limit: rawLimit,
          hostId: toolHostId,
        } = (input ?? {}) as {
          page?: string
          filters?: Record<string, string>
          lastHours?: number
          limit?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const limit = Math.min(
          Math.max(1, Math.floor(rawLimit ?? PAGE_DATA_DEFAULT_LIMIT)),
          PAGE_DATA_MAX_LIMIT
        )
        const window =
          typeof lastHours === 'number'
            ? Math.min(Math.max(1, Math.floor(lastHours)), 720)
            : undefined

        if (!page || page.trim() === '') {
          return { type: 'page_list' as const, pages: listPages() }
        }

        const { hasTable } = await import('@/lib/api/table-registry')
        const { hasChart } = await import('@/lib/api/chart-registry')
        const resolved = resolvePage(page.slice(0, 200), { hasTable, hasChart })

        if (!resolved) {
          return {
            type: 'page_list' as const,
            note: `Unknown page "${page.slice(0, 200)}". Pick one of these routes, or pass a query-config / chart name.`,
            pages: listPages(),
          }
        }
        if ('nonData' in resolved) {
          return {
            type: 'page_data' as const,
            page: resolved.page,
            sources: [],
            note: `This page has no query data to replay (${resolved.nonData}).`,
          }
        }

        const all = [
          ...resolved.configs.map((name) => ({ name, kind: 'table' as const })),
          ...resolved.charts.map((name) => ({ name, kind: 'chart' as const })),
        ]
        const run = all.slice(0, PAGE_DATA_MAX_SOURCES)
        const skipped = all.slice(PAGE_DATA_MAX_SOURCES).map((s) => s.name)

        const sources = await mapLimit(run, CONCURRENCY, (s) =>
          s.kind === 'table'
            ? runTableSource(s.name, resolvedHostId, filters, window, limit)
            : runChartSource(s.name, resolvedHostId, filters, window, limit)
        )
        fitToBudget(sources, PAGE_DATA_MAX_BYTES)

        return {
          type: 'page_data' as const,
          page: resolved.page,
          title: resolved.title,
          sources,
          ...(skipped.length > 0
            ? {
                skipped,
                note: `Only the first ${PAGE_DATA_MAX_SOURCES} sources ran; call again with a skipped name as \`page\`.`,
              }
            : {}),
        }
      },
    }),
  }
}
