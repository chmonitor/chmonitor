/**
 * Pick the cluster to fan live / catalog queries out over: the widest PHYSICAL
 * cluster (most members) so a single fan-out covers every host. Logical
 * clusters reuse the same hosts by name. Falls back to the cluster with the
 * most members.
 *
 * Shared by /api/v1/cluster-topology and schema/settings node-vs-node diffs.
 */
export function pickFanoutCluster(
  rows: Array<{ cluster: string; host_name: string; port: number }>
): string | null {
  const counts = new Map<string, Set<string>>()
  const physical = new Set<string>()
  for (const r of rows) {
    if (!counts.has(r.cluster)) counts.set(r.cluster, new Set())
    counts.get(r.cluster)!.add(`${r.host_name}:${r.port}`)
    const n = r.cluster
    if (
      n === 'default' ||
      n.startsWith('default') ||
      n === 'all-replicated' ||
      n === 'all-sharded'
    ) {
      physical.add(n)
    }
  }
  let best: string | null = null
  let bestSize = -1
  for (const [name, hosts] of counts) {
    const isPhysical = physical.has(name)
    const size = hosts.size + (isPhysical ? 10_000 : 0)
    if (size > bestSize) {
      bestSize = size
      best = name
    }
  }
  return best
}
