import {
  attributeParams,
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
        c.query,
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

  it('sends no log_comment and no comment when attribution is off', async () => {
    process.env.CHM_QUERY_ATTRIBUTION = 'false'
    process.env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT = 'true'
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal }, () =>
      client.query({ query: 'SELECT 1', clickhouse_settings: { readonly: 2 } })
    )
    expect(calls[0]).toEqual({
      query: 'SELECT 1',
      clickhouse_settings: { readonly: 2 },
    })
  })

  it('adds the SQL comment and email only when opted in', async () => {
    process.env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT = 'true'
    process.env.CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL = 'true'
    process.env.CHM_QUERY_ATTRIBUTION_LABEL = 'env=prod'
    const { client, calls } = fakeClient()
    await runWithAttribution({ principal, source: 'console' }, () =>
      client.query({ query: 'SELECT 1' })
    )
    expect(calls[0].query).toStartWith(
      '/* chmonitor v=1 version=0.3.0+abc user=jane host=ch-0 source=console label=env=prod */\n'
    )
    expect(calls[0].query).toEndWith('SELECT 1')
    const record = JSON.parse(String(calls[0].clickhouse_settings?.log_comment))
    expect(record.email).toBe('jane@example.com')
    expect(record.label).toBe('env=prod')
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
          throw new Error(
            "Code: 164. DB::Exception: Cannot modify 'log_comment' setting in readonly mode. (READONLY)"
          )
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
    expect(calls[1].query).toStartWith('/* chmonitor v=1 ')
    expect(calls[1].query).toContain('user=jane host=ch-0 source=console')
    expect(calls[2].query).toEndWith('SELECT 2')
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

  it('keeps a log_comment the caller set explicitly', async () => {
    const params = await attributeParams(
      { query: 'SELECT 1', clickhouse_settings: { log_comment: 'mine' } },
      'ch-0'
    )
    expect(params.clickhouse_settings.log_comment).toBe('mine')
  })
})
