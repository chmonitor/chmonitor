/**
 * SECURITY: only whitelisted count keys are allowed. Clients send a countKey
 * and cluster name, never raw SQL. Unlike menu-count-registry these queries use
 * clusterAllReplicas() to aggregate across nodes.
 */

import { CLUSTER_FANOUT_SETTINGS } from '@/lib/cluster/fanout-settings'

export interface ClusterCountQuery {
  /** SQL query with {cluster: String} parameter */
  query: string
  optional?: boolean
  tableCheck?: string
}

export const clusterCountRegistry: Record<string, ClusterCountQuery> = {
  'readonly-tables-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replicas)
      WHERE is_readonly = 1
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },

  'replication-queue-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replication_queue)
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },

  'replication-lag-critical-in-cluster': {
    query: `
      SELECT COUNT() as count
      FROM clusterAllReplicas({cluster: String}, system.replicas)
      WHERE absolute_delay > 300
      ${CLUSTER_FANOUT_SETTINGS}
    `,
  },
}

export function getClusterCountQuery(
  countKey: string
): ClusterCountQuery | null {
  return clusterCountRegistry[countKey] || null
}

export function hasClusterCountKey(countKey: string): boolean {
  return countKey in clusterCountRegistry
}

export function getAvailableClusterCountKeys(): string[] {
  return Object.keys(clusterCountRegistry)
}
