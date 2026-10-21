import type { DeclarativeQueryConfig } from '../../schema'

export const backupsDeclarative: DeclarativeQueryConfig = {
  name: 'backups',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['status'] },
  description: `To restore a backup:
      RESTORE TABLE data_lake.events AS data_lake.events_restore FROM Disk('s3_backup', 'data_lake.events_20231212')`,
  docs: `The required table 'backup_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#backup_log to ensure the necessary table is available. Make sure you have at least one backup to have this table available.`,
  optional: true,
  tableCheck: 'system.backup_log',
  sql: `
      SELECT *,
        formatReadableSize(total_size) as readable_total_size,
        formatReadableSize(uncompressed_size) as readable_uncompressed_size,
        formatReadableSize(compressed_size) as readable_compressed_size,
        formatReadableSize(bytes_read) as readable_bytes_read,
        formatReadableQuantity(files_read) as readable_files_read,
        formatReadableQuantity(num_entries) as readable_num_entries
      FROM system.backup_log
      ORDER BY start_time DESC
    `,
  columns: [
    'id',
    'name',
    'status',
    'start_time',
    'end_time',
    'num_files',
    'readable_total_size',
    'num_entries',
    'readable_uncompressed_size',
    'readable_compressed_size',
    'readable_files_read',
    'readable_bytes_read',
    'error',
  ],
  columnFormats: {
    status: 'colored-badge',
    start_time: 'related-time',
    end_time: 'related-time',
    error: 'code-dialog',
    ProfileEvents: 'code',
  },
  relatedCharts: [
    [
      'backup-size',
      {
        title: 'Backup',
        lastHours: 24 * 14,
      },
    ],
  ],
}
