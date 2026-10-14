import type { QueryConfig } from '@/types/query-config'

export const replicatedFetchesConfig: QueryConfig = {
  name: 'replicated-fetches',
  defaultView: 'auto',
  card: { primary: 'table' },
  description:
    'Currently executing background part downloads from replica sources',
  optional: true,
  tableCheck: 'system.replicated_fetches',
  refreshInterval: 30_000,
  sql: `
      SELECT
        database,
        table,
        elapsed,
        formatReadableTimeDelta(elapsed) AS readable_elapsed,
        round(progress * 100, 1) AS progress_pct,
        result_part_name,
        formatReadableSize(total_size_bytes_compressed) AS readable_size,
        formatReadableSize(bytes_read_compressed) AS readable_read,
        source_replica_hostname,
        source_replica_port,
        to_detached,
        thread_id
      FROM system.replicated_fetches
      ORDER BY elapsed DESC
    `,
  columns: [
    'database',
    'table',
    'readable_elapsed',
    'progress_pct',
    'result_part_name',
    'readable_size',
    'readable_read',
    'source_replica_hostname',
    'source_replica_port',
    'to_detached',
    'thread_id',
  ],
}
