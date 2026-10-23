/** SECURITY: only whitelisted count keys are allowed; clients send a countKey, never raw SQL. */

import { QUERY_COMMENT_FINGERPRINT } from '@chm/clickhouse-client/constants'
import { EVENTS_TABLE } from '@/lib/app-tables'
import { LOCAL_DATABASES_FILTER } from '@/lib/clickhouse-local-databases'

export interface MenuCountQuery {
  query: string
  optional?: boolean
  tableCheck?: string | string[]
  /**
   * Opt out of the ClickHouse query-cache settings (#2182) the menu-counts
   * routes apply by default to every count query.
   */
  disableQueryCache?: boolean
}

export const menuCountRegistry: Record<string, MenuCountQuery> = {
  'tables-explorer': {
    query: `SELECT COUNT() as count FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') AND ${LOCAL_DATABASES_FILTER} AND is_temporary = 0 AND engine LIKE '%MergeTree%'`,
  },
  'tables-overview': {
    query: `SELECT countDistinct(database, table) as count FROM system.parts WHERE active`,
  },
  'distributed-ddl-queue': {
    query: `SELECT COUNT() as count FROM system.distributed_ddl_queue WHERE status != 'Finished'`,
    optional: true,
    // Without Keeper the count fails with NO_ELEMENTS_IN_CONFIG (#3919).
    tableCheck: ['system.distributed_ddl_queue', 'system.zookeeper'],
  },
  'table-replicas': {
    query: `SELECT COUNT() as count FROM system.replicas`,
  },
  'replication-queue': {
    query: `SELECT COUNT() as count FROM system.replication_queue`,
  },
  'readonly-tables': {
    query: `SELECT COUNT() as count FROM system.replicas WHERE is_readonly = 1`,
  },
  'view-refreshes': {
    query: `SELECT COUNT() as count FROM system.view_refreshes`,
  },

  'running-queries': {
    query: `SELECT COUNT() as count FROM system.processes WHERE is_cancelled = 0 AND position(query, '${QUERY_COMMENT_FINGERPRINT}') = 0`,
  },

  merges: {
    query: `SELECT COUNT() as count FROM system.merges WHERE 1 = 1`,
  },

  disks: {
    query: `SELECT COUNT() as count FROM system.disks`,
  },
  metrics: {
    query: `SELECT COUNT() as count FROM system.metrics`,
  },
  settings: {
    query: `SELECT COUNT() as count FROM system.settings`,
  },
  'mergetree-settings': {
    query: `SELECT COUNT() as count FROM system.merge_tree_settings`,
  },
  clusters: {
    query: `SELECT COUNT(DISTINCT cluster) as count FROM system.clusters`,
    optional: true,
    tableCheck: 'system.clusters',
  },
  backups: {
    query: `SELECT COUNT() as count FROM system.backup_log WHERE status = 'BACKUP_CREATED'`,
    optional: true,
    tableCheck: 'system.backup_log',
  },
  'page-views': {
    query: `SELECT COUNT() as count FROM ${EVENTS_TABLE} WHERE kind = 'PageView'`,
    optional: true,
    tableCheck: EVENTS_TABLE,
  },
  dictionaries: {
    query: `SELECT COUNT() as count FROM system.dictionaries`,
    optional: true,
    tableCheck: 'system.dictionaries',
  },
}

export function getMenuCountQuery(countKey: string): MenuCountQuery | null {
  return menuCountRegistry[countKey] || null
}

export function hasMenuCountKey(countKey: string): boolean {
  return countKey in menuCountRegistry
}

export function getAvailableMenuCountKeys(): string[] {
  return Object.keys(menuCountRegistry)
}
