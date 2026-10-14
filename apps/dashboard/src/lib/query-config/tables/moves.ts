import type { QueryConfig } from '@/types/query-config'

export const movesConfig: QueryConfig = {
  name: 'moves',
  defaultView: 'auto',
  card: { primary: 'table' },
  description:
    'In-progress part moves between disks and volumes (TTL / storage policy)',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.moves',
  sql: `SELECT database, table, elapsed, formatReadableTimeDelta(elapsed) AS readable_elapsed, target_disk_name, target_disk_path, part_name, formatReadableSize(part_size) AS readable_part_size, thread_id FROM system.moves ORDER BY elapsed DESC`,
  columns: [
    'database',
    'table',
    'readable_elapsed',
    'target_disk_name',
    'target_disk_path',
    'part_name',
    'readable_part_size',
    'thread_id',
  ],
}
