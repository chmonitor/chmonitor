/**
 * Live Postgres integration tests for `@chm/postgres-client`.
 *
 * These hit a REAL Postgres server (see the `test-postgres-integration` CI
 * job in `.github/workflows/test.yml`, which runs `postgres:17` via `docker
 * run` so `pg_stat_statements` can be preloaded). They self-skip whenever
 * `POSTGRES_HOST` is unset — i.e. in the `unit-tests` job and for local
 * `bun test` runs without a live database — so they never affect the
 * required check. Run locally with:
 *
 *   docker run -d --name chm-pg -p 5432:5432 \
 *     -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=chm_test \
 *     postgres:17
 *   POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=postgres \
 *     POSTGRES_PASSWORD=postgres POSTGRES_DATABASE=chm_test \
 *     bun test packages/postgres-client/src/client.integration.test.ts
 */

import {
  formatPostgresError,
  getPostgresVersion,
  type PostgresConnectionConfig,
  queryPostgres,
} from './client'
import { describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const HAS_LIVE_POSTGRES = !!process.env.POSTGRES_HOST

const config: PostgresConnectionConfig = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DATABASE ?? 'chm_test',
  sslmode: process.env.POSTGRES_SSLMODE ?? 'disable',
}

/** A raw `pg` client for tests that need to bypass the read-only query path. */
function newRawClient(): Client {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: false,
  })
}

describe.skipIf(!HAS_LIVE_POSTGRES)('live Postgres — queryPostgres', () => {
  test('getPostgresVersion returns a real server version string', async () => {
    const version = await getPostgresVersion(config)
    expect(version).toContain('PostgreSQL')
  })

  test('queryPostgres returns rows + field metadata for a SELECT', async () => {
    const { rows, fields } = await queryPostgres<{ n: number; label: string }>(
      config,
      'SELECT $1::int AS n, $2::text AS label',
      [42, 'hello']
    )
    expect(rows).toEqual([{ n: 42, label: 'hello' }])
    expect(fields.map((f) => f.name)).toEqual(['n', 'label'])
    expect(fields.every((f) => typeof f.dataTypeID === 'number')).toBe(true)
  })

  test('assertReadOnlyStatement blocks a write before it ever reaches Postgres', async () => {
    await expect(
      queryPostgres(config, 'CREATE TEMP TABLE should_not_exist (id int)')
    ).rejects.toThrow(/read-only statements are allowed/i)
  })

  test('the session read-only pin rejects a write server-side (SQLSTATE 25006)', async () => {
    // Exercises the AUTHORITATIVE guard directly: even if a write slipped past
    // `assertReadOnlyStatement`, `SET default_transaction_read_only = on`
    // (which `queryPostgres` issues on every connection) makes Postgres itself
    // reject it with `25006 read_only_sql_transaction`.
    //
    // NOTE: this must be a PERMANENT table — Postgres allows writes to a
    // session-local TEMP table even under `default_transaction_read_only`
    // (temp tables aren't WAL-logged), so a temp table would not exercise the
    // guard. Use a fresh setup/teardown connection (without the pin) to
    // create/drop it, matching the "raw client, not queryPostgres" note above.
    const tableName = `pg_integration_write_probe_${Date.now()}`
    const setupClient = newRawClient()
    await setupClient.connect()
    try {
      await setupClient.query(`CREATE TABLE ${tableName} (id int)`)
    } finally {
      await setupClient.end()
    }

    const client = newRawClient()
    await client.connect()
    try {
      await client.query('SET default_transaction_read_only = on')
      await expect(
        client.query(`INSERT INTO ${tableName} VALUES (1)`)
      ).rejects.toMatchObject({ code: '25006' })
    } finally {
      await client.end()
    }

    const teardownClient = newRawClient()
    await teardownClient.connect()
    try {
      await teardownClient.query(`DROP TABLE IF EXISTS ${tableName}`)
    } finally {
      await teardownClient.end()
    }
  })

  test('wrong password classifies as SQLSTATE 28P01', async () => {
    const badConfig: PostgresConnectionConfig = {
      ...config,
      password: 'definitely-not-the-password',
    }
    let caught: unknown
    try {
      await queryPostgres(badConfig, 'SELECT 1')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(formatPostgresError(caught)).toContain('[28P01]')
  })

  test('unknown database classifies as SQLSTATE 3D000', async () => {
    const badConfig: PostgresConnectionConfig = {
      ...config,
      database: 'this_database_does_not_exist_chm',
    }
    let caught: unknown
    try {
      await queryPostgres(badConfig, 'SELECT 1')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(formatPostgresError(caught)).toContain('[3D000]')
  })

  test('connection-refused port classifies as ECONNREFUSED (or 08006)', async () => {
    const badConfig: PostgresConnectionConfig = {
      ...config,
      // Port 1 is reserved and nothing listens there in CI.
      port: 1,
    }
    let caught: unknown
    try {
      await queryPostgres(badConfig, 'SELECT 1')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    const formatted = formatPostgresError(caught)
    expect(formatted).toMatch(/\[(ECONNREFUSED|08006)\]/)
  })

  test('statement_timeout fires on a long-running query (SQLSTATE 57014)', async () => {
    let caught: unknown
    try {
      await queryPostgres(config, 'SELECT pg_sleep(30)')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(formatPostgresError(caught)).toContain('[57014]')
  }, 20_000)
})
