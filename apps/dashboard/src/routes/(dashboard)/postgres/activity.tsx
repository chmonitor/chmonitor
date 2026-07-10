import { createFileRoute } from '@tanstack/react-router'

import { PgPage } from '@/components/postgres/pg-page'
import { pgRunningQueriesConfig } from '@/lib/pg-query-config'

/**
 * Postgres Running Queries — live client backends from `pg_stat_activity`
 * (issue #2450). Polls on a short interval, mirroring the ClickHouse Running
 * Queries view.
 */
function PostgresActivityPage() {
  return <PgPage config={pgRunningQueriesConfig} refetchInterval={5_000} />
}

export const Route = createFileRoute('/(dashboard)/postgres/activity')({
  component: PostgresActivityPage,
})
