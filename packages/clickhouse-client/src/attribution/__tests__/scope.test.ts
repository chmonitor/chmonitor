import { QUERY_COMMENT } from '../../clickhouse/constants'
import {
  attributeParams,
  displaySql,
  runWithAttribution,
  setAttributionVersion,
  withQueryAttribution,
} from '../scope'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const ENV_KEYS = [
  'CHM_QUERY_ATTRIBUTION',
  'CHM_QUERY_ATTRIBUTION_SQL_COMMENT',
  'CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL',
  'CHM_QUERY_ATTRIBUTION_LABEL',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  setAttributionVersion('0.3.0+abc')
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  setAttributionVersion(null)
})

type Params = { query: string; clickhouse_settings?: Record<string, unknown> }

/** The JSON body of the query's leading comment. */
function leading(query: string): Record<string, unknown> {
  const match = query.match(/^\/\* (\{[^\n]*\}) \*\/\n/)
  if (!match) throw new Error(`no leading comment: ${query}`)
  return JSON.parse(match[1])
}

/** The query without its leading comment line. */
const body = (query: string) => query.slice(query.indexOf('*/\n') + 3)

function fakeClient() {
  const calls: Params[] = []
  const client = {
    query: async (params: Params) => {
      calls.push(params)
      return { ok: true }
    },
    command: async (params: Params) => {
      calls.push(params)
      return { ok: true }
    },
  }
  withQueryAttribution(client as any, 'ch-0')
  return { client, calls }
}

/** Shape of `ClickHouseError` from @clickhouse/client-common: `code` is a string. */
function chError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const readonlyRefusal = () =>
  chError(
    '164',
    "Code: 164. DB::Exception: Cannot modify 'log_comment' setting in readonly mode. (READONLY)"
  )

const principal = async () => ({ subject: 'jane', email: 'jane@example.com' })

describe('withQueryAttribution', () => {
  it('tags each query with the scope it runs in, on one shared client', async () => {
    const { client, calls } = fakeClient()

    await Promise.all([
      runWithAttribution({ principal, source: 'chart:a' }, () =>
        client.query({ query: 'SELECT 1' })
      ),
      runWithAttribution({ source: 'cron:sweep' }, () =>
        client.query({ query: 'SELECT 2' })
      ),
    ])

    const byQuery = Object.fromEntries(
      calls.map((c) => [
        body(c.query),
        JSON.parse(String(c.clickhouse_settings?.log_comment)),
      ])
    )
    expect(byQuery['SELECT 1']).toMatchObject({
      app: 'chmonitor',
      user: 'jane',
      host: 'ch-0',
      source: 'chart:a',
      version: '0.3.0+abc',
    })
    expect(byQuery['SELECT 1'].email).toBeUndefined()
    expect(byQuery['SELECT 2']).toMatchObject({
      user: null,
      source: 'cron:sweep',
    })
  })

  it('lets a nested scope narrow the source and keep the principal', async () => {
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal, source: 'agent' }, () =>
      runWithAttribution({ source: 'chart:inner' }, () =>
        client.command({ query: 'SELECT 1' })
      )
    )
    const record = JSON.parse(String(calls[0].clickhouse_settings?.log_comment))
    expect(record).toMatchObject({ user: 'jane', source: 'chart:inner' })
  })

  it('keeps only the minimal comment and no log_comment when attribution is off', async () => {
    process.env.CHM_QUERY_ATTRIBUTION = 'false'
    process.env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT = 'true'
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal }, () =>
      client.query({
        query: `${QUERY_COMMENT}SELECT 1`,
        clickhouse_settings: { readonly: 2 },
      })
    )
    expect(calls[0]).toEqual({
      query: `${QUERY_COMMENT}SELECT 1`,
      clickhouse_settings: { readonly: 2 },
    })
  })

  it('replaces QUERY_COMMENT with one attribution comment by default', async () => {
    process.env.CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL = 'true'
    process.env.CHM_QUERY_ATTRIBUTION_LABEL = 'env=prod'
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal, source: 'console' }, () =>
      client.query({
        query: `${QUERY_COMMENT}\n    ${QUERY_COMMENT}    SELECT 1`,
      })
    )
    expect(calls[0].query).toBe(
      '/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,"version":"0.3.0+abc","user":"jane","source":"console","host":"ch-0","label":"env=prod"} */\nSELECT 1'
    )
    const record = JSON.parse(String(calls[0].clickhouse_settings?.log_comment))
    expect(record.email).toBe('jane@example.com')
    expect(record.label).toBe('env=prod')
  })

  it('sends the minimal comment plus log_comment when the SQL comment is off', async () => {
    process.env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT = 'false'
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal }, () =>
      client.query({ query: 'SELECT 1' })
    )
    expect(calls[0].query).toBe(`${QUERY_COMMENT}SELECT 1`)
    expect(
      JSON.parse(String(calls[0].clickhouse_settings?.log_comment)).user
    ).toBe('jane')
  })

  it('treats a failing principal lookup as anonymous instead of failing the query', async () => {
    const { client, calls } = fakeClient()
    await runWithAttribution(
      {
        principal: async () => {
          throw new Error('jwks down')
        },
      },
      () => client.query({ query: 'SELECT 1' })
    )
    expect(
      JSON.parse(String(calls[0].clickhouse_settings?.log_comment)).user
    ).toBeNull()
  })

  it('falls back to the SQL comment when a readonly=1 profile refuses log_comment', async () => {
    const calls: Params[] = []
    const client = {
      query: async (params: Params) => {
        calls.push(params)
        if (params.clickhouse_settings?.log_comment) {
          throw readonlyRefusal()
        }
        return { ok: true }
      },
    }
    withQueryAttribution(client as any, 'ch-0')

    await runWithAttribution({ principal, source: 'console' }, async () => {
      await client.query({ query: 'SELECT 1' })
      await client.query({ query: 'SELECT 2' })
    })

    expect(calls.map((c) => Boolean(c.clickhouse_settings))).toEqual([
      true,
      false,
      false,
    ])
    expect(leading(calls[1].query)).toMatchObject({
      user: 'jane',
      host: 'ch-0',
      source: 'console',
    })
    expect(body(calls[2].query)).toBe('SELECT 2')
  })

  it('does not retry other readonly refusals', async () => {
    let sent = 0
    const client = {
      query: async () => {
        sent++
        throw new Error(
          'Code: 164. DB::Exception: Cannot execute query in readonly mode. (READONLY)'
        )
      },
    }
    withQueryAttribution(client as any, 'ch-0')
    await expect(client.query()).rejects.toThrow('readonly mode')
    expect(sent).toBe(1)
  })

  it('does not retry or downgrade when a query raises the refusal text itself', async () => {
    const calls: Params[] = []
    const client = {
      query: async (params: Params) => {
        calls.push(params)
        if (params.query.includes('throwIf')) {
          throw chError(
            '395',
            "Code: 395. DB::Exception: Cannot modify 'log_comment' setting in readonly mode: while executing 'FUNCTION throwIf(1)'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)"
          )
        }
        return { ok: true }
      },
    }
    withQueryAttribution(client as any, 'ch-0')

    await expect(
      client.query({
        query:
          "SELECT throwIf(1, 'Cannot modify ''log_comment'' setting in readonly mode')",
      })
    ).rejects.toThrow('log_comment')
    await client.query({ query: 'SELECT 1' })

    expect(calls).toHaveLength(2)
    expect(calls[1].clickhouse_settings?.log_comment).toBeDefined()
    expect(body(calls[1].query)).toBe('SELECT 1')
  })

  it('never resends a refused command, and uses the SQL comment from the next call', async () => {
    const calls: Params[] = []
    const client = {
      command: async (params: Params) => {
        calls.push(params)
        if (params.clickhouse_settings?.log_comment) throw readonlyRefusal()
        return { ok: true }
      },
    }
    withQueryAttribution(client as any, 'ch-0')

    await expect(
      client.command({ query: 'INSERT INTO t VALUES (1)' })
    ).rejects.toThrow('log_comment')
    expect(calls).toHaveLength(1)

    await client.command({ query: 'INSERT INTO t VALUES (2)' })
    expect(calls).toHaveLength(2)
    expect(calls[1].clickhouse_settings).toBeUndefined()
    expect(leading(calls[1].query).app).toBe('chmonitor')
  })

  it('records no user or email for a demo host, and never resolves the principal', async () => {
    process.env.CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL = 'true'
    let resolved = 0
    const calls: Params[] = []
    const client = {
      query: async (params: Params) => {
        calls.push(params)
        return { ok: true }
      },
    }
    withQueryAttribution(client as any, 'demo', { anonymous: () => true })

    await runWithAttribution(
      {
        principal: async () => {
          resolved++
          return principal()
        },
        source: 'console',
      },
      () => client.query({ query: 'SELECT 1' })
    )

    const record = JSON.parse(String(calls[0].clickhouse_settings?.log_comment))
    expect(record).toMatchObject({
      user: null,
      host: 'demo',
      source: 'console',
    })
    expect(record.email ?? null).toBeNull()
    expect(leading(calls[0].query).user).toBeNull()
    expect(resolved).toBe(0)
  })

  it('keeps a log_comment the caller set explicitly', async () => {
    const params = await attributeParams(
      { query: 'SELECT 1', clickhouse_settings: { log_comment: 'mine' } },
      'ch-0'
    )
    expect(params.clickhouse_settings.log_comment).toBe('mine')
  })
})

describe('displaySql', () => {
  it('shows the comment the query is sent with, without the user', async () => {
    const shown = await runWithAttribution(
      { principal, source: 'chart:x' },
      () => displaySql(`${QUERY_COMMENT}SELECT 1`, 'ch-0')
    )
    expect(shown).toBe(
      '/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,"version":"0.3.0+abc","user":null,"source":"chart:x","host":"ch-0","label":null} */\nSELECT 1'
    )
  })

  it('shows the minimal comment when attribution is off', () => {
    process.env.CHM_QUERY_ATTRIBUTION = 'false'
    expect(displaySql('SELECT 1', 'ch-0')).toBe(`${QUERY_COMMENT}SELECT 1`)
  })
})

/**
 * Before ClickHouse 25.x `log_comment` is part of the query cache key
 * (measured: 24.8 misses on a different value, 26.5 hits), so a per-user
 * value would give every user their own cache entry for the same chart.
 */
describe('query cache', () => {
  it('leaves log_comment out of a cached query so users share one entry', async () => {
    const params = await runWithAttribution({ principal }, () =>
      attributeParams(
        { query: 'SELECT 1', clickhouse_settings: { use_query_cache: 1 } },
        'ch-0'
      )
    )
    expect(params.clickhouse_settings).toEqual({ use_query_cache: 1 })
    expect(leading(params.query).user).toBe('jane')
  })

  it('keeps log_comment on a cached query when the SQL comment is off', async () => {
    process.env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT = 'false'
    const params = await runWithAttribution({ principal }, () =>
      attributeParams(
        { query: 'SELECT 1', clickhouse_settings: { use_query_cache: 1 } },
        'ch-0'
      )
    )
    expect(
      JSON.parse(String(params.clickhouse_settings.log_comment)).user
    ).toBe('jane')
  })
})
