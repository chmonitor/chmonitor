import { type ColumnStatsByTable, fetchColumnStats } from '../cost-estimator'
import { describe, expect, test } from 'bun:test'

const DELAY_MS = 80

type ColumnRow = {
  name: string
  uncompressed_bytes: number
  total_rows: number
}

type BatchColumnRow = ColumnRow & {
  database: string
  table: string
}

const TABLES = [
  { database: 'db', table: 'a' },
  { database: 'db', table: 'b' },
  { database: 'db', table: 'c' },
]

/** Numbers live only here. The querier is the only source the code sees. */
const FIXTURE: Record<string, ColumnRow[]> = {
  'db.a': [
    { name: 'a_id', uncompressed_bytes: 100, total_rows: 10 },
    { name: 'a_payload', uncompressed_bytes: 400, total_rows: 10 },
  ],
  'db.b': [
    { name: 'b_id', uncompressed_bytes: 220, total_rows: 25 },
    { name: 'b_payload', uncompressed_bytes: 880, total_rows: 25 },
  ],
  'db.c': [
    { name: 'c_id', uncompressed_bytes: 50, total_rows: 7 },
    { name: 'c_ts', uncompressed_bytes: 910, total_rows: 7 },
  ],
}

type RecordedCall = {
  start: number
  end: number
  bytes: number
  sql: string
  params?: Record<string, unknown>
  useCache?: boolean
  hostId: number
}

function isColumnRow(value: unknown): value is ColumnRow {
  if (typeof value !== 'object' || value === null) return false
  if (!('name' in value) || !('uncompressed_bytes' in value)) return false
  if (!('total_rows' in value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.uncompressed_bytes === 'number' &&
    typeof value.total_rows === 'number'
  )
}

function createQuerier() {
  const calls: RecordedCall[] = []

  async function querier(options: {
    query: string
    hostId: number
    query_params?: Record<string, unknown>
    useCache?: boolean
  }): Promise<ColumnRow[] | BatchColumnRow[]> {
    const start = performance.now()
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS))

    const params = options.query_params
    let rows: ColumnRow[] | BatchColumnRow[]
    if (
      params &&
      typeof params.database === 'string' &&
      typeof params.table === 'string'
    ) {
      const found = FIXTURE[`${params.database}.${params.table}`]
      if (!found) {
        throw new Error(`unknown table ${params.database}.${params.table}`)
      }
      rows = found.map((column) => ({ ...column }))
    } else if (params && 'db_0' in params && 'tbl_0' in params) {
      const batched: BatchColumnRow[] = []
      for (let i = 0; ; i++) {
        const dbKey = `db_${i}`
        const tblKey = `tbl_${i}`
        if (!(dbKey in params) || !(tblKey in params)) break
        const database = params[dbKey]
        const table = params[tblKey]
        if (typeof database !== 'string' || typeof table !== 'string') {
          throw new Error(`non-string batch param at ${i}`)
        }
        const found = FIXTURE[`${database}.${table}`]
        if (!found) throw new Error(`unknown table ${database}.${table}`)
        for (const column of found) {
          batched.push({ database, table, ...column })
        }
      }
      rows = batched
    } else {
      throw new Error(
        `unexpected column-stats query shape: ${JSON.stringify(params)}`
      )
    }

    const end = performance.now()
    calls.push({
      start,
      end,
      bytes: JSON.stringify(rows).length,
      sql: options.query,
      params,
      useCache: options.useCache,
      hostId: options.hostId,
    })
    return rows
  }

  return { calls, querier }
}

function statsView(stats: ColumnStatsByTable) {
  return [...stats.keys()].sort().map((key) => {
    const value = stats.get(key)
    if (!value) throw new Error(`missing stats for ${key}`)
    return {
      key,
      totalRows: value.totalRows,
      columnBytes: [...value.columnBytes.keys()].sort().map((name) => ({
        name,
        bytes: value.columnBytes.get(name),
      })),
    }
  })
}

describe('fetchColumnStats batch', () => {
  test('zero tables returns an empty map and does not query', async () => {
    const { calls, querier } = createQuerier()
    const got = await fetchColumnStats(0, [], querier)
    expect(calls).toHaveLength(0)
    expect(got.size).toBe(0)
  })

  test('one table keeps the per-table query_params', async () => {
    const { calls, querier } = createQuerier()
    const got = await fetchColumnStats(0, [TABLES[0]], querier)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.hostId).toBe(0)
    expect(calls[0]?.useCache).toBe(true)
    expect(calls[0]?.params?.table).toBe('a')
    expect(calls[0]?.params?.database).toBe('db')
    expect(calls[0]?.sql).toContain('system.columns')
    expect(calls[0]?.sql).toContain('system.tables')
    expect(calls[0]?.sql).toContain('{database:String}')
    expect(calls[0]?.sql).toContain('{table:String}')
    expect(calls[0]?.sql).not.toContain('{db_0:String}')
    expect(got.get('db.a')?.totalRows).toBe(10)
    expect(got.get('db.a')?.columnBytes.get('a_id')).toBe(100)
    expect(got.get('db.a')?.columnBytes.get('a_payload')).toBe(400)
  })

  test('three tables: one read, half the uncoordinated makespan, same map', async () => {
    const { calls, querier } = createQuerier()

    await fetchColumnStats(0, [TABLES[0]], querier)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params?.table).toBe('a')
    const singleSql = calls[0]?.sql ?? ''
    calls.length = 0

    const expected: ColumnStatsByTable = new Map()
    for (const table of TABLES) {
      const returned = await querier({
        query: singleSql,
        hostId: 0,
        query_params: { database: table.database, table: table.table },
        useCache: true,
      })
      if (!Array.isArray(returned) || !returned.every(isColumnRow)) {
        throw new Error('baseline did not return single-table column rows')
      }
      const columnBytes = new Map<string, number>()
      let totalRows: number | null = null
      for (const row of returned) {
        columnBytes.set(row.name, Number(row.uncompressed_bytes))
        if (row.total_rows != null) totalRows = Number(row.total_rows)
      }
      expected.set(`${table.database}.${table.table}`, {
        totalRows,
        columnBytes,
      })
    }

    expect(calls).toHaveLength(TABLES.length)
    const baseline = calls.splice(0, calls.length)
    const sumOfUnitDelays = baseline.reduce(
      (sum, call) => sum + (call.end - call.start),
      0
    )
    const baselineBytes = baseline.map((call) => call.bytes)
    const baselineSum = baselineBytes.reduce((sum, bytes) => sum + bytes, 0)

    for (let run = 1; run <= 2; run++) {
      calls.length = 0
      const started = performance.now()
      const got = await fetchColumnStats(0, TABLES, querier)
      const makespan = performance.now() - started

      expect(statsView(got)).toEqual(statsView(expected))
      expect(calls).toHaveLength(1)
      const invocations = calls.length
      expect(invocations).toBeLessThanOrEqual(0.5 * TABLES.length)

      expect(makespan).toBeLessThanOrEqual(0.5 * sumOfUnitDelays)

      const invocationRatio = invocations / TABLES.length
      const makespanRatio = makespan / sumOfUnitDelays
      console.log(
        `run ${run}: invocations/unbatched=${invocationRatio.toFixed(3)} makespan/sum=${makespanRatio.toFixed(3)}`
      )

      const batchedBytes = calls[0]?.bytes ?? 0
      expect(batchedBytes).toBeGreaterThan(0)
      const call = calls[0]
      if (!call) throw new Error('missing batched call')
      expect(call.useCache).toBe(true)
      expect(call.hostId).toBe(0)
      expect(call.sql).toContain('system.columns')
      expect(call.sql).toContain('system.tables')
      expect(call.sql).toContain('c.database AS database')
      expect(call.sql).toContain('c.table AS table')
      expect(call.sql).toContain(
        'sum(c.data_uncompressed_bytes) AS uncompressed_bytes'
      )
      expect(call.sql).toContain('any(t.total_rows) AS total_rows')
      expect(call.sql).toContain('GROUP BY c.database, c.table, c.name')
      expect(call.sql).toContain('{db_0:String}')
      expect(call.sql).toContain('{tbl_0:String}')
      expect(call.sql).toContain('{db_1:String}')
      expect(call.sql).toContain('{tbl_1:String}')
      expect(call.sql).toContain('{db_2:String}')
      expect(call.sql).toContain('{tbl_2:String}')
      expect(call.sql).not.toContain("'db'")
      expect(call.params).toEqual({
        db_0: 'db',
        tbl_0: 'a',
        db_1: 'db',
        tbl_1: 'b',
        db_2: 'db',
        tbl_2: 'c',
      })

      if (batchedBytes === baselineSum) {
        expect(batchedBytes).toBe(baselineSum)
      } else {
        for (const single of baselineBytes) {
          expect(batchedBytes).toBeGreaterThanOrEqual(single)
        }
        for (const columns of Object.values(FIXTURE)) {
          for (const column of columns) {
            const present = [...got.values()].some((stats) =>
              stats.columnBytes.has(column.name)
            )
            expect(present).toBe(true)
          }
        }
      }
    }
  })
})
