import { queryAttributionHandler } from '@/start'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isEnvHostDemo,
  withQueryAttribution,
} from '@chm/clickhouse-client/attribution'

/**
 * #4164 acceptance: a page load by a trusted-auth user writes a record with
 * user, source, page and label; cron and anonymous requests carry user null.
 * Drives the real middleware handler and the real auth provider, with a fake
 * ClickHouse client standing in for the pooled one.
 */

const ENV = {
  CHM_AUTH_PROVIDER: 'trusted',
  CHM_TRUSTED_AUTH_SECRET: 'proxy-secret',
  CHM_QUERY_ATTRIBUTION_LABEL: 'env=test',
}
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved.CHM_CLOUD_MODE = process.env.CHM_CLOUD_MODE
  delete process.env.CHM_CLOUD_MODE
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
})

afterEach(() => {
  for (const k of [...Object.keys(ENV), 'CHM_CLOUD_MODE']) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function recordFor(request: Request, host = 'ch-0') {
  const sent: Array<{ clickhouse_settings?: { log_comment?: string } }> = []
  const client = withQueryAttribution(
    {
      query: async (params: (typeof sent)[number]) => {
        sent.push(params)
        return {}
      },
    } as never,
    host,
    { anonymous: isEnvHostDemo }
  ) as unknown as { query: (p: { query: string }) => Promise<unknown> }

  await queryAttributionHandler({
    request,
    next: () => client.query({ query: 'SELECT 1' }),
  })
  return JSON.parse(String(sent[0]?.clickhouse_settings?.log_comment))
}

describe('queryAttributionHandler', () => {
  test('a trusted-auth chart request carries user, source, page and label', async () => {
    const record = await recordFor(
      new Request('https://dash.example/api/v1/charts/query-count?host=0', {
        headers: {
          'X-Chm-Proxy-Secret': 'proxy-secret',
          'X-Forwarded-User': 'jane',
          'X-Forwarded-Email': 'jane@example.com',
          Referer: 'https://dash.example/overview?host=0',
        },
      })
    )
    expect(record).toMatchObject({
      app: 'chmonitor',
      v: 1,
      user: 'jane',
      host: 'ch-0',
      source: 'chart:query-count',
      page: '/overview',
      label: 'env=test',
    })
    expect(record.email).toBeUndefined()
  })

  test('forged identity headers without the proxy secret stay anonymous', async () => {
    const record = await recordFor(
      new Request('https://dash.example/api/v1/explorer/query', {
        headers: { 'X-Forwarded-User': 'admin' },
      })
    )
    expect(record).toMatchObject({ user: null, source: 'console' })
  })

  test('a cron request has user null and the job as source', async () => {
    const record = await recordFor(
      new Request('https://dash.example/api/cron/health-sweep', {
        headers: { Authorization: 'Bearer cron' },
      })
    )
    expect(record).toMatchObject({ user: null, source: 'cron:health-sweep' })
  })

  test('the none provider never resolves a user', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    const record = await recordFor(
      new Request('https://dash.example/api/v1/tables/merges', {
        headers: { 'X-Forwarded-User': 'jane' },
      })
    )
    expect(record).toMatchObject({ user: null, source: 'table:merges' })
  })

  test('cloud mode records no user for the env hosts, which are the public demo', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    const record = await recordFor(
      new Request('https://dash.example/api/v1/explorer/query', {
        headers: {
          'X-Chm-Proxy-Secret': 'proxy-secret',
          'X-Forwarded-User': 'jane',
          'X-Forwarded-Email': 'jane@example.com',
        },
      }),
      'duet-ubuntu'
    )
    expect(record).toMatchObject({ user: null, host: 'duet-ubuntu' })
    expect(record.email ?? null).toBeNull()
  })
})
