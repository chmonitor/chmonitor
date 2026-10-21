/**
 * WHY: POST /api/v1/charts/batch used to JSON.parse every chart's `dataJson`
 * and let Response.json stringify the same rows again. The handler now splices
 * the raw string into the body. Clients depend on the exact shape (`data` is
 * always an array, `error` only when present), so this pins the new body
 * byte-for-byte to what the parse-based path produced.
 */

import type { ChartGroupingEntry } from '@/lib/api/chart-batch'

import { describe, expect, mock, test } from 'bun:test'
import * as realBatch from '@/lib/api/chart-batch'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

// Captured before mock.module: the namespace import is live-bound to the mock.
const { getChartGrouping, groupingCacheControl } = realBatch
const GROUPING = 'insights-stats'
const names = [...(getChartGrouping(GROUPING) ?? [])]

let fixtures: ChartGroupingEntry[] = []
mock.module('@/lib/api/chart-batch', () => ({
  ...realBatch,
  executeChartGrouping: async () => {
    const out: Record<string, ChartGroupingEntry> = {}
    names.forEach((name, i) => {
      const entry = fixtures[i]
      if (entry) out[name] = entry
    })
    return out
  },
}))

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
  isAnonymousPublicReadRequest: async () => false,
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  isDemoHostBlockedForRequest: async () => false,
}))

const { handler } = await import('../batch')

const HOST_ID = 3

/** The previous implementation, kept verbatim as the oracle. */
function legacyParseDataJson(dataJson: string | null): unknown[] {
  if (!dataJson || dataJson === 'null') return []
  try {
    const parsed = JSON.parse(dataJson) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch {
    return []
  }
}

function legacyResponse(grouped: Record<string, ChartGroupingEntry>): Response {
  const data: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(grouped)) {
    data[name] = {
      data: legacyParseDataJson(entry.dataJson),
      metadata: {
        queryId: String(entry.metadata?.queryId || ''),
        duration: Number(entry.metadata?.duration || 0),
        rows: Number(entry.metadata?.rows || 0),
        host: String(HOST_ID),
        sql: entry.executedSql?.trim(),
      },
      ...(entry.error
        ? { error: { type: entry.error.type, message: entry.error.message } }
        : {}),
    }
  }
  return Response.json(
    { success: true, data },
    { headers: { 'Cache-Control': groupingCacheControl(names) } }
  )
}

async function run(entries: ChartGroupingEntry[]) {
  fixtures = entries
  const grouped: Record<string, ChartGroupingEntry> = {}
  names.forEach((name, i) => {
    if (entries[i]) grouped[name] = entries[i]
  })
  const actual = await handler(
    new Request('http://localhost/api/v1/charts/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupingId: GROUPING, hostId: HOST_ID }),
    })
  )
  const expected = legacyResponse(grouped)
  return { actual, expected }
}

const rows = [
  { ts: '2026-01-01 00:00:00', n: 1.5, big: 12345678901, s: 'a"b\\c\n' },
  { ts: '2026-01-01 00:01:00', n: 0, big: -1, s: 'üñí ✓ </script>' },
  { nested: { a: [1, 2, { b: null }] }, flag: true },
]

function entry(
  dataJson: string | null,
  extra: Partial<ChartGroupingEntry> = {}
): ChartGroupingEntry {
  return {
    dataJson,
    metadata: { queryId: 'q-1', duration: 12, rows: 3 },
    executedSql: '  SELECT 1  \n',
    ...extra,
  }
}

describe('POST /api/v1/charts/batch raw dataJson splice', () => {
  test('grouping has enough charts for the mixed fixture', () => {
    expect(names.length).toBeGreaterThanOrEqual(8)
  })

  test('mixed entries: body bytes and headers equal the parse-based output', async () => {
    const { actual, expected } = await run([
      entry(JSON.stringify(rows)),
      entry('[]'),
      entry(null),
      entry('null'),
      entry(''),
      entry(JSON.stringify(rows[0])),
      entry(null, {
        error: { type: 'table_not_found', message: 'no such "table"' } as never,
        metadata: undefined,
        executedSql: undefined,
      }),
      entry(JSON.stringify(rows), {
        error: { type: 'timeout', message: 'slow' } as never,
      }),
    ])

    expect(actual.status).toBe(200)
    expect(actual.headers.get('Content-Type')).toBe(
      expected.headers.get('Content-Type') ?? ''
    )
    expect(actual.headers.get('Cache-Control')).toBe(
      expected.headers.get('Cache-Control') ?? ''
    )
    const actualText = await actual.text()
    expect(actualText).toBe(await expected.text())

    // Guard against the oracle and the handler both being empty.
    const parsed = JSON.parse(actualText) as {
      success: boolean
      data: Record<string, { data: unknown[]; error?: { type: string } }>
    }
    expect(parsed.success).toBe(true)
    expect(parsed.data[names[0] as string]?.data).toEqual(rows)
    expect(parsed.data[names[1] as string]?.data).toEqual([])
    expect(parsed.data[names[2] as string]?.data).toEqual([])
    expect(parsed.data[names[3] as string]?.data).toEqual([])
    expect(parsed.data[names[4] as string]?.data).toEqual([])
    expect(parsed.data[names[5] as string]?.data).toEqual([rows[0]])
    expect(parsed.data[names[6] as string]?.error?.type).toBe('table_not_found')
    expect(parsed.data[names[7] as string]?.data).toEqual(rows)
    expect(parsed.data[names[0] as string]?.error).toBeUndefined()
  })

  test('large payload is spliced without being altered', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({
      i,
      v: `value-${i}`,
      f: i / 7,
    }))
    const { actual, expected } = await run([entry(JSON.stringify(big))])
    expect(await actual.text()).toBe(await expected.text())
  })

  test('an empty grouping result still returns a valid body', async () => {
    const { actual, expected } = await run([])
    const text = await actual.text()
    expect(text).toBe(await expected.text())
    expect(JSON.parse(text)).toEqual({ success: true, data: {} })
  })
})
