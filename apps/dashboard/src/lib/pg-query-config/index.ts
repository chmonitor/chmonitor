/**
 * Central registry for Postgres query configs (issue #2450). The Postgres
 * analog of `lib/query-config/index.ts`, kept separate so the ClickHouse
 * registry stays engine-pure. Keyed by `PgQueryConfig.name`; the
 * `/api/v1/pg/query/:name` route and the Postgres pages resolve configs here.
 */

import type { PgQueryConfig } from '@/types/pg-query-config'

import { pgRunningQueriesConfig } from './running-queries'
import { pgSlowPatternsConfig } from './slow-patterns'

export { pgRunningQueriesConfig, pgSlowPatternsConfig }

const PG_QUERY_CONFIGS: readonly PgQueryConfig[] = [
  pgSlowPatternsConfig,
  pgRunningQueriesConfig,
]

const PG_QUERY_CONFIG_BY_NAME = new Map<string, PgQueryConfig>(
  PG_QUERY_CONFIGS.map((c) => [c.name, c])
)

/** Look up a Postgres query config by its registry `name`. */
export function getPgQueryConfigByName(
  name: string
): PgQueryConfig | undefined {
  return PG_QUERY_CONFIG_BY_NAME.get(name)
}
