/**
 * Live Postgres integration tests for `executePgQuery` / `isPgExtensionInstalled`
 * — the dashboard's Postgres query executor (Phase 2/3, #2450), including its
 * SSRF guard (`validatePostgresHost`).
 *
 * These hit a REAL Postgres server (see the `test-postgres-integration` CI
 * job in `.github/workflows/test.yml`). They self-skip whenever
 * `POSTGRES_HOST` is unset — i.e. in the `unit-tests` job and for local
 * `bun test` runs without a live database — so they never affect the
 * required check. Run locally with:
 *
 *   docker run -d --name chm-pg -p 5432:5432 \
 *     -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=chm_test \
 *     postgres:17 -c shared_preload_libraries=pg_stat_statements
 *   docker exec chm-pg psql -U postgres -d chm_test \
 *     -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'
 *   POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=postgres \
 *     POSTGRES_PASSWORD=postgres POSTGRES_DATABASE=chm_test \
 *     CHM_ALLOW_PRIVATE_HOSTS=true \
 *     bun test apps/dashboard/src/lib/connection-query/execute-pg-query.integration.test.ts
 */

import type { PostgresConnectionConfig } from '@chm/postgres-client'

import { executePgQuery, isPgExtensionInstalled } from './execute-pg-query'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const HAS_LIVE_POSTGRES = !!process.env.POSTGRES_HOST

const config: PostgresConnectionConfig = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DATABASE ?? 'chm_test',
  sslmode: process.env.POSTGRES_SSLMODE ?? 'disable',
}

describe.skipIf(!HAS_LIVE_POSTGRES)(
  'live Postgres — executePgQuery / isPgExtensionInstalled',
  () => {
    // These need CHM_ALLOW_PRIVATE_HOSTS=true (the CI job sets it) since the
    // target is localhost/127.0.0.1 — a private/loopback address the SSRF
    // guard blocks by default.
    describe('with private hosts allowed', () => {
      const savedAllowPrivate = process.env.CHM_ALLOW_PRIVATE_HOSTS

      beforeEach(() => {
        process.env.CHM_ALLOW_PRIVATE_HOSTS = 'true'
      })

      afterEach(() => {
        if (savedAllowPrivate === undefined) {
          delete process.env.CHM_ALLOW_PRIVATE_HOSTS
        } else {
          process.env.CHM_ALLOW_PRIVATE_HOSTS = savedAllowPrivate
        }
      })

      test('executePgQuery returns rows + duration/row-count metadata', async () => {
        const result = await executePgQuery(config, 'SELECT $1::int AS n', [7])
        expect(result.data).toEqual([{ n: 7 }])
        expect(result.metadata.rows).toBe(1)
        expect(result.metadata.duration).toBeGreaterThanOrEqual(0)
      })

      test('isPgExtensionInstalled is false for a bogus extension name', async () => {
        const installed = await isPgExtensionInstalled(
          config,
          'this_extension_does_not_exist_chm'
        )
        expect(installed).toBe(false)
      })

      test('isPgExtensionInstalled is true for pg_stat_statements (enabled by the CI job)', async () => {
        const installed = await isPgExtensionInstalled(
          config,
          'pg_stat_statements'
        )
        expect(installed).toBe(true)
      })
    })

    describe('SSRF guard — private hosts NOT allowed (default)', () => {
      const savedAllowPrivate = process.env.CHM_ALLOW_PRIVATE_HOSTS
      const savedDeploymentMode = process.env.CHM_DEPLOYMENT_MODE

      beforeEach(() => {
        delete process.env.CHM_ALLOW_PRIVATE_HOSTS
        delete process.env.CHM_DEPLOYMENT_MODE
      })

      afterEach(() => {
        if (savedAllowPrivate === undefined) {
          delete process.env.CHM_ALLOW_PRIVATE_HOSTS
        } else {
          process.env.CHM_ALLOW_PRIVATE_HOSTS = savedAllowPrivate
        }
        if (savedDeploymentMode === undefined) {
          delete process.env.CHM_DEPLOYMENT_MODE
        } else {
          process.env.CHM_DEPLOYMENT_MODE = savedDeploymentMode
        }
      })

      test('rejects a loopback target before ever connecting', async () => {
        await expect(
          executePgQuery({ ...config, host: '127.0.0.1' }, 'SELECT 1')
        ).rejects.toThrow(/internal addresses are not allowed/i)
      })
    })
  }
)
