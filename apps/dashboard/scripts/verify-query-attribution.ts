/**
 * Live check for query attribution (#4164) against a real ClickHouse.
 *
 *   CHM_VERIFY_CLICKHOUSE_URL=http://127.0.0.1:8123 \
 *     bun scripts/verify-query-attribution.ts
 *
 * The script creates `chm_attr_ro1` (readonly=1) and `chm_attr_ro2`
 * (readonly=2), which needs a writable access storage. Or point it at
 * existing users with CHM_VERIFY_RO1_USER, CHM_VERIFY_RO2_USER and
 * CHM_VERIFY_RO_PASSWORD.
 *
 * 1. Sends queries through the real pooled `getClient` inside attribution
 *    scopes, as `default`, as readonly=2, and as readonly=1 (which refuses
 *    `log_comment` and must fall back to the SQL comment).
 * 2. Flushes logs and runs every Dashboard usage config with
 *    enable_analyzer 0 and 1, asserting the tagged rows come back.
 */

import { createClient } from '@clickhouse/client-web'

import { getClient } from '@chm/clickhouse-client'
import {
  runWithAttribution,
  setAttributionVersion,
  withQueryAttribution,
} from '@chm/clickhouse-client/attribution'
import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { dashboardUsageConfigs } from '@/lib/query-config/queries/dashboard-usage'

const url = process.env.CHM_VERIFY_CLICKHOUSE_URL
if (!url) {
  console.error('Set CHM_VERIFY_CLICKHOUSE_URL to a scratch ClickHouse.')
  process.exit(2)
}

const failures: string[] = []
function check(label: string, ok: boolean, detail = ''): void {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`
  )
  if (!ok) failures.push(label)
}

const admin = createClient({ url, username: 'default', password: '' })
const run = Date.now().toString(36)
const tag = (who: string) => `${who}-${run}`

async function main(): Promise<void> {
  const version = await (
    await admin.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' })
  ).json<{ v: string }>()
  console.log(`ClickHouse ${version[0]?.v}, run ${run}`)
  const [major = 0, minor = 0] = String(version[0]?.v).split('.').map(Number)
  // `enable_analyzer` replaced `allow_experimental_analyzer` in 24.3.
  const analyzerSetting =
    major * 100 + minor >= 2403
      ? 'enable_analyzer'
      : 'allow_experimental_analyzer'

  if (!process.env.CHM_VERIFY_RO1_USER) {
    for (const [name, level] of [
      ['chm_attr_ro1', 1],
      ['chm_attr_ro2', 2],
    ] as const) {
      await admin.command({
        query: `CREATE USER IF NOT EXISTS ${name} IDENTIFIED WITH no_password SETTINGS readonly = ${level}`,
      })
      await admin.command({ query: `GRANT SELECT ON system.* TO ${name}` })
    }
  }
  const ro1User = process.env.CHM_VERIFY_RO1_USER ?? 'chm_attr_ro1'
  const ro2User = process.env.CHM_VERIFY_RO2_USER ?? 'chm_attr_ro2'
  const roPassword = process.env.CHM_VERIFY_RO_PASSWORD ?? ''

  setAttributionVersion('0.0.0+verify')
  process.env.CHM_QUERY_ATTRIBUTION_LABEL = `run=${run}`

  const hosts = [
    { id: 0, user: 'default', who: 'default' },
    { id: 1, user: ro2User, who: 'ro2' },
    { id: 2, user: ro1User, who: 'ro1' },
  ]
  process.env.CLICKHOUSE_HOST = hosts.map(() => url).join(',')
  process.env.CLICKHOUSE_USER = hosts.map((h) => h.user).join(',')
  process.env.CLICKHOUSE_PASSWORD = hosts
    .map((h) => (h.who === 'default' ? '' : roPassword))
    .join(',')
  process.env.CLICKHOUSE_NAME = hosts.map((h) => `ch-${h.who}`).join(',')

  console.log('\nSend attributed queries through getClient')
  for (const host of hosts) {
    const client = await getClient({ hostId: host.id })
    const principal = async () => ({ subject: tag(host.who) })
    for (const source of ['chart:verify', 'console']) {
      try {
        await runWithAttribution(
          { principal, source, page: '/verify' },
          async () => {
            const rs = await client.query({
              query: 'SELECT 1 AS one',
              format: 'JSONEachRow',
              clickhouse_settings: { readonly: '1' },
            })
            await rs.json()
          }
        )
        check(`${host.who} ${source} succeeds`, true)
      } catch (err) {
        // A readonly=1 profile also refuses the client-level
        // max_execution_time (#3684); that is not an attribution failure.
        const msg = String(err)
        check(
          `${host.who} ${source} succeeds`,
          host.who === 'ro1' && msg.includes("'max_execution_time'"),
          msg.split('\n')[0]
        )
      }
    }
  }

  // The readonly=1 path without the client-level timeout, wrapped the way
  // the per-user connection client is (its SSRF guard refuses 127.0.0.1).
  const ro1 = withQueryAttribution(
    createClient({ url, username: ro1User, password: roPassword }),
    null
  )
  try {
    await runWithAttribution(
      { principal: async () => ({ subject: tag('ro1') }), source: 'agent' },
      async () => {
        const rs = await ro1.query({ query: 'SELECT 1', format: 'JSONEachRow' })
        await rs.json()
      }
    )
    check('readonly=1 profile falls back to the SQL comment and succeeds', true)
  } catch (err) {
    check(
      'readonly=1 profile falls back to the SQL comment and succeeds',
      false,
      String(err).split('\n')[0]
    )
  }

  console.log('\nThe leading comment in system.processes')
  const def = await getClient({ hostId: 0 })
  const slow = runWithAttribution(
    { principal: async () => ({ subject: tag('proc') }), source: 'console' },
    async () => {
      const rs = await def.query({
        query: `${QUERY_COMMENT}SELECT sleep(2) AS s`,
        format: 'JSONEachRow',
      })
      await rs.json()
    }
  )
  await new Promise((r) => setTimeout(r, 700))
  const running = await (
    await admin.query({
      query: `SELECT query FROM system.processes WHERE position(query, {t:String}) > 0 AND position(query, 'system.processes') = 0`,
      query_params: { t: tag('proc') },
      format: 'JSONEachRow',
    })
  ).json<{ query: string }>()
  await slow
  const proc = running[0]?.query ?? ''
  check(
    'system.processes.query starts with one attribution comment',
    proc.startsWith(
      `/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,`
    ) && proc.split('/*').length === 2,
    proc.slice(0, 160)
  )

  console.log('\nQuery cache shared across users (use_query_cache=1)')
  const cacheSql = `SELECT count() AS c, ${run.length} AS r FROM numbers(1000)`
  const cacheIds: string[] = []
  for (const who of ['cache-a', 'cache-b']) {
    await runWithAttribution(
      { principal: async () => ({ subject: tag(who) }), source: 'chart:cache' },
      async () => {
        const rs = await def.query({
          query: cacheSql,
          format: 'JSONEachRow',
          clickhouse_settings: { use_query_cache: 1 },
        })
        cacheIds.push(rs.query_id)
        await rs.json()
      }
    )
  }

  await admin.command({ query: 'SYSTEM FLUSH LOGS' })

  const cacheRows = await (
    await admin.query({
      query: `SELECT query_id, ProfileEvents['QueryCacheHits'] AS hits, normalized_query_hash AS h FROM system.query_log WHERE type = 'QueryFinish' AND query_id IN {ids:Array(String)}`,
      query_params: { ids: cacheIds },
      format: 'JSONEachRow',
    })
  ).json<{ query_id: string; hits: string; h: string }>()
  const second = cacheRows.find((r) => r.query_id === cacheIds[1])
  check(
    'second user hits the entry the first user cached',
    Number(second?.hits) === 1,
    `hits=${second?.hits}`
  )
  check(
    'both users share one normalized_query_hash',
    cacheRows.length === 2 && cacheRows[0].h === cacheRows[1].h,
    cacheRows.map((r) => r.h).join(',')
  )

  console.log('\nquery_log carriers')
  const carriers = await (
    await admin.query({
      query: `SELECT
          countIf(log_comment = '' AND startsWith(query, '/* {"client":"clickhouse-monitoring","app":"chmonitor"')) AS comment_only,
          countIf(JSONExtractString(log_comment, 'app') = 'chmonitor' AND startsWith(query, '/* {"client":"clickhouse-monitoring","app":"chmonitor"')) AS both
        FROM system.query_log
        WHERE type = 'QueryFinish' AND position(query, {run:String}) > 0`,
      query_params: { run: `run=${run}` },
      format: 'JSONEachRow',
    })
  ).json<{ comment_only: string; both: string }>()
  check(
    'readonly=1 rows carry only the leading comment',
    Number(carriers[0]?.comment_only) > 0,
    `comment_only=${carriers[0]?.comment_only}`
  )
  check(
    'other rows carry log_comment and the leading comment',
    Number(carriers[0]?.both) > 0,
    `both=${carriers[0]?.both}`
  )

  // Second flush: the usage configs below read the rows sent above.
  await admin.command({ query: 'SYSTEM FLUSH LOGS' })

  console.log('\nRun every Dashboard usage config (enable_analyzer 0 and 1)')
  for (const analyzer of [0, 1]) {
    for (const config of dashboardUsageConfigs) {
      const label = `${config.name} analyzer=${analyzer}`
      try {
        const rows = await (
          await admin.query({
            query: config.sql as string,
            query_params: { days: 7 },
            format: 'JSONEachRow',
            clickhouse_settings: { [analyzerSetting]: analyzer },
          })
        ).json<Record<string, unknown>>()
        const text = JSON.stringify(rows)
        const expected =
          config.name === 'dashboard-usage-by-user' ||
          config.name === 'dashboard-usage-expensive'
            ? [tag('default'), tag('ro2'), tag('ro1')]
            : config.name === 'dashboard-usage-by-source'
              ? ['chart:verify', 'console', 'agent']
              : config.name === 'dashboard-usage-by-label'
                ? [`run=${run}`]
                : config.name === 'dashboard-usage-by-version'
                  ? ['0.0.0+verify']
                  : []
        const missing = expected.filter((e) => !text.includes(e))
        check(
          label,
          rows.length > 0 && missing.length === 0,
          missing.length
            ? `missing ${missing.join(', ')}`
            : `${rows.length} rows`
        )
      } catch (err) {
        check(label, false, String(err).split('\n')[0])
      }
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nAll checks passed')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
