import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'

import { rowBelongsToNode, uniqueClusterNodes } from './unique-nodes'
import { describe, expect, test } from 'bun:test'

function row(
  partial: Pick<
    ClusterTopologyRow,
    'cluster' | 'host_name' | 'host_address' | 'port' | 'is_local'
  >
): ClusterTopologyRow {
  return {
    shard_num: 1,
    shard_weight: 1,
    internal_replication: 1,
    replica_num: 1,
    user: 'default',
    default_database: 'default',
    errors_count: 0,
    slowdowns_count: 0,
    estimated_recovery_time: 0,
    database_shard_name: '',
    database_replica_name: '',
    is_active: null,
    replication_lag: null,
    recovery_time: null,
    ...partial,
  }
}

describe('uniqueClusterNodes', () => {
  test('merges is_local aliases into one node', () => {
    const nodes = uniqueClusterNodes([
      row({
        cluster: 'default',
        host_name: 'localhost',
        host_address: '127.0.0.1',
        port: 9000,
        is_local: 1,
      }),
      row({
        cluster: 'prod',
        host_name: 'chi-prod-0-0',
        host_address: '10.0.0.1',
        port: 9000,
        is_local: 1,
      }),
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].isLocal).toBe(true)
    expect(nodes[0].hostName).toBe('chi-prod-0-0')
    expect(nodes[0].aliases).toContain('localhost')
    expect(nodes[0].aliases).toContain('chi-prod-0-0')
  })

  test('keeps two physical replicas distinct', () => {
    const nodes = uniqueClusterNodes([
      row({
        cluster: 'default',
        host_name: 'chi-prod-0-0',
        host_address: '10.0.0.1',
        port: 9000,
        is_local: 1,
      }),
      row({
        cluster: 'default',
        host_name: 'chi-prod-0-1',
        host_address: '10.0.0.2',
        port: 9000,
        is_local: 0,
      }),
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.hostName).sort()).toEqual([
      'chi-prod-0-0',
      'chi-prod-0-1',
    ])
  })

  test('merges rows that share a routable address:port', () => {
    const nodes = uniqueClusterNodes([
      row({
        cluster: 'a',
        host_name: 'chi-prod-0-1',
        host_address: '10.0.0.2',
        port: 9000,
        is_local: 0,
      }),
      row({
        cluster: 'b',
        host_name: '10.0.0.2',
        host_address: '10.0.0.2',
        port: 9000,
        is_local: 0,
      }),
    ])
    expect(nodes).toHaveLength(1)
  })
})

describe('rowBelongsToNode', () => {
  test('matches any alias case-insensitively', () => {
    const [node] = uniqueClusterNodes([
      row({
        cluster: 'default',
        host_name: 'chi-prod-0-0',
        host_address: '10.0.0.1',
        port: 9000,
        is_local: 1,
      }),
    ])
    expect(rowBelongsToNode('chi-prod-0-0', node)).toBe(true)
    expect(rowBelongsToNode('10.0.0.1', node)).toBe(true)
    expect(rowBelongsToNode('CHI-PROD-0-0', node)).toBe(true)
    expect(rowBelongsToNode('other', node)).toBe(false)
  })
})
