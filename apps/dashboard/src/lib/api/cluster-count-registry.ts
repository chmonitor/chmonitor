/**
 * Cluster count registry that maps count keys to their SQL queries.
 * This centralizes all cluster-level count queries on the server side,
 * preventing SQL from being sent from the frontend.
 *
 * Unlike menu-count-registry (host-level queries), these queries use
 * clusterAllReplicas() to aggregate data across all nodes in a cluster.
 *
 * SECURITY: Only whitelisted count keys are allowed.
 * Clients send a countKey and cluster name, not raw SQL.
 */

import { CLUSTER_FANOUT_SETTINGS } from '@/lib/cluster/fanout-settings'

export interface ClusterCountQuery {
  /** SQL query with {cluster: String} parameter */
  query: string
  /** If true, returns null instead of error when table doesn't exist */
  optional?: boolean
  /** Table to check existence for (if optional) */
  tableCheck?: string
}

/**
 * Registry of cluster count queries.
 * Keys are used in API calls to identify which query to run.
 */
export const clusterCountRegistry: Record<string, ClusterCountQuery> = {
  // Readonly tables across all replicas in the cluster
  'readonly-tables-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replicas)
      WHERE is_readonly = 1
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },

  // Replication queue size across the cluster
  'replication-queue-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replication_queue)
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },

  // Tables with high replication lag
  'replication-lag-critical-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replicas)
      WHERE absolute_delay > 300
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },
}

/**
 * Get a cluster count query by key
 */
export function getClusterCountQuery(
  countKey: string
): ClusterCountQuery | null {
  return clusterCountRegistry[countKey] || null
}

/**
 * Check if a count key exists in the registry
 */
export function hasClusterCountKey(countKey: string): boolean {
  return countKey in clusterCountRegistry
}

/**
 * Get all available count keys
 */
export function getAvailableClusterCountKeys(): string[] {
  return Object.keys(clusterCountRegistry)
}
