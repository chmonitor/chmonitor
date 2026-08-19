import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'

import { fetchData } from '@chm/clickhouse-client' // pragma: allowlist secret
import { uniqueClusterNodes } from '@/lib/cluster/unique-nodes'
import { clustersTopologyConfig } from '@/lib/query-config/system/clusters-topology'

/**
 * List unique physical nodes for a saved host using the same clusters-topology
 * query as /cluster. Never invents a second listing query.
 */
export async function loadClusterNodes(hostId: number): Promise<{
  nodes: ReturnType<typeof uniqueClusterNodes>
  rows: ClusterTopologyRow[]
}> {
  try {
    const structural = await fetchData<ClusterTopologyRow[]>({
      query: '',
      hostId,
      format: 'JSONEachRow',
      queryConfig: clustersTopologyConfig,
    })
    if (structural.error || !Array.isArray(structural.data)) {
      return { nodes: [], rows: [] }
    }
    const rows = structural.data
    return { nodes: uniqueClusterNodes(rows), rows }
  } catch {
    return { nodes: [], rows: [] }
  }
}
