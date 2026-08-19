import type { DiffPeer } from '@/lib/compare/merged-diff-hosts'
import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'

import { uniqueClusterNodes } from '@/lib/cluster/unique-nodes'
import { queryDiffPeer } from '@/lib/compare/merged-diff-hosts'
import { clustersTopologyConfig } from '@/lib/query-config/system/clusters-topology'

/**
 * List unique physical nodes for a saved host using the same clusters-topology
 * query as /cluster. Works for env, database, and browser peers.
 */
export async function loadClusterNodes(peer: DiffPeer): Promise<{
  nodes: ReturnType<typeof uniqueClusterNodes>
  rows: ClusterTopologyRow[]
}> {
  try {
    const rows = await queryDiffPeer<ClusterTopologyRow>(peer, {
      query: '',
      queryConfig: clustersTopologyConfig,
      optional: true,
    })
    if (!Array.isArray(rows) || rows.length === 0) {
      return { nodes: [], rows: [] }
    }
    return { nodes: uniqueClusterNodes(rows), rows }
  } catch {
    return { nodes: [], rows: [] }
  }
}
