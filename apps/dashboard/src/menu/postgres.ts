import { MixIcon } from '@radix-ui/react-icons'
import { ActivityIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

// Postgres-only nav (issue #2450, decision 4). These items appear ONLY when
// the active host is a Postgres source (`engines: ['postgres']`); for
// ClickHouse hosts they are filtered out, so the ClickHouse menu is byte-for
// -byte unchanged. Fail-closed: Postgres sources only exist behind
// CHM_FEATURE_POSTGRES_SOURCE, so with the flag off the active engine is
// always ClickHouse and these never render.
export const postgresItems: MenuItem[] = [
  {
    title: 'Query Insights',
    href: '/postgres/queries',
    description:
      'Slow query patterns from pg_stat_statements — calls, execution time, cache hit ratio, and WAL per pattern',
    icon: ActivityIcon,
    section: 'main',
    isNew: true,
    engines: ['postgres'],
    docs: 'https://www.postgresql.org/docs/current/pgstatstatements.html',
  },
  {
    title: 'Running Queries',
    href: '/postgres/activity',
    description:
      'Live client backends from pg_stat_activity — state, wait events, and current-statement duration',
    icon: MixIcon,
    section: 'main',
    isNew: true,
    engines: ['postgres'],
    docs: 'https://www.postgresql.org/docs/current/monitoring-stats.html',
  },
]
