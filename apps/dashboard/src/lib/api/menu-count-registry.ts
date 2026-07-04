/**
 * Menu count registry that maps count keys to their SQL queries.
 * This centralizes all menu count queries on the server side,
 * preventing SQL from being sent from the frontend.
 *
 * SECURITY: Only whitelisted count keys are allowed.
 * Clients send a countKey, not raw SQL.
 */

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { EVENTS_TABLE } from '@/lib/app-tables'

export interface MenuCountQuery {
  query: string
  optional?: boolean
  tableCheck?: string
  /**
   * Opt out of the ClickHouse query-cache settings (#2182) the menu-counts
   * routes apply by default to every count query.
   */
  disableQueryCache?: boolean
}

/**
 * Registry of menu count queries.
 * Keys match the countKey in menu.ts MenuItem definitions.
 */
export const menuCountRegistry: Record<string, MenuCountQuery> = {
  // Tables menu
  'tables-explorer': {
    query: `SELECT COUNT() as count FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') AND is_temporary = 0 AND engine LIKE '%MergeTree%'`,
  },
  'tables-overview': {
    query: `SELECT countDistinct(database, table) as count FROM system.parts WHERE active`,
  },
  'distributed-ddl-queue': {
    query: `SELECT COUNT() as count FROM system.distributed_ddl_queue WHERE status != 'Finished'`,
    optional: true,
    tableCheck: 'system.distributed_ddl_queue',
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

  // Queries menu
  'running-queries': {
    query: `SELECT COUNT() as count FROM system.processes WHERE is_cancelled = 0 AND query NOT LIKE '%${QUERY_COMMENT}%'`,
  },

  // Merges menu
  merges: {
    query: `SELECT COUNT() as count FROM system.merges WHERE 1 = 1`,
  },

  // More menu
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

/**
 * Get a menu count query by key
 */
export function getMenuCountQuery(countKey: string): MenuCountQuery | null {
  return menuCountRegistry[countKey] || null
}

/**
 * Check if a count key exists in the registry
 */
export function hasMenuCountKey(countKey: string): boolean {
  return countKey in menuCountRegistry
}

/**
 * Get all available count keys
 */
export function getAvailableMenuCountKeys(): string[] {
  return Object.keys(menuCountRegistry)
}
