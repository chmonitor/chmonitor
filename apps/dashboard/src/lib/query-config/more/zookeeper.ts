import type { QueryConfig } from '@/types/query-config'

import { ZOOKEEPER } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const zookeeperConfig: QueryConfig = {
  name: 'zookeeper',
  defaultView: 'auto',
  card: { primary: '_path' },
  description:
    'Exposes data from the Keeper cluster defined in the config. https://clickhouse.com/docs/en/operations/system-tables/zookeeper',
  docs: ZOOKEEPER,
  optional: true,
  tableCheck: 'system.zookeeper',
  sql: `
      SELECT
          replaceOne(format('{}/{}', path, name), '//', '/') AS _path,
          value,
          dataLength,
          numChildren,
          ctime AS created_at,
          mtime AS updated_at,
          version AS num_node_changes,
          cversion AS num_child_changes
      FROM system.zookeeper
      WHERE path = replaceOne({path: String}, '//', '/')
      ORDER BY updated_at DESC
  `,
  columns: [
    '_path',
    'value',
    'dataLength',
    'numChildren',
    'created_at',
    'updated_at',
    'num_node_changes',
    'num_child_changes',
  ],
  columnFormats: {
    _path: [ColumnFormat.Link, { href: `?path=[_path]` }],
    value: ColumnFormat.CodeToggle,
    created_at: ColumnFormat.RelatedTime,
    updated_at: ColumnFormat.RelatedTime,
  },
  defaultParams: { path: '/' },
  relatedCharts: [
    [
      'zookeeper-requests',
      {
        title: 'ZooKeeper Requests/Watch',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
      },
    ],
    'break',
    [
      'zookeeper-wait',
      {
        title: 'ZooKeeper Wait Seconds',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
      },
    ],
    'break',
    'zookeeper-uptime',
    'zookeeper-summary-table',
    ['zookeeper-exception', {}],
    'break',
  ],
}
