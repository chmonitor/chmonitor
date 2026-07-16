/**
 * Replica detection — bills a detected ClickHouse replica host at 0.5 of a
 * full host, mirroring pganalyze's standby-replica discount (issue #2379).
 *
 * A host's role is read from its own cluster topology (`system.clusters`):
 * hosts that share the same `(cluster, shard_num)` pair are replicas of each
 * other — redundant copies of the same shard's data. The first host counted
 * for a given shard is billed as a full host; every additional host in that
 * same shard is a replica, billed at {@link REPLICA_HOST_WEIGHT}. Hosts with
 * no cluster (standalone) or a different shard are always full hosts.
 *
 * Detection is best-effort and fails safe: any error probing a host (network,
 * auth, older ClickHouse versions without `system.clusters`, timeout) resolves
 * to {@link STANDALONE_TOPOLOGY} — a probe failure can only forfeit the
 * discount for that one host, never over-discount revenue or block a request.
 */

import type { ConnectionCredentials } from '@/lib/connection-store/types'

import { queryConnection } from '@/lib/connection-query/connection-client'

/** Billing weight of a host confirmed to be a replica of an already-counted host. */
export const REPLICA_HOST_WEIGHT = 0.5
/** Billing weight of a standalone host, or the first host counted in a shard. */
export const PRIMARY_HOST_WEIGHT = 1

/** A host's cluster/shard membership, or both null when standalone/unknown. */
export interface HostTopology {
  cluster: string | null
  shardNum: number | null
}

export const STANDALONE_TOPOLOGY: HostTopology = {
  cluster: null,
  shardNum: null,
}

const PROBE_TIMEOUT_MS = 2000

/**
 * Probe a host's cluster/shard membership. Reads `system.clusters` for the
 * cluster this host's own instance belongs to (`is_local = 1`) — if the host
 * is a member of more than one cluster, the first row (arbitrary but stable
 * per host) is used. Fails safe to {@link STANDALONE_TOPOLOGY} on any error or
 * if the probe exceeds {@link PROBE_TIMEOUT_MS}.
 */
export async function probeHostTopology(
  credentials: ConnectionCredentials
): Promise<HostTopology> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('replica-topology-probe-timeout')),
        PROBE_TIMEOUT_MS
      )
    })
    const result = await Promise.race([
      queryConnection<{ cluster: string; shard_num: number }>(
        credentials,
        'SELECT cluster, shard_num FROM system.clusters WHERE is_local = 1 ORDER BY cluster LIMIT 1'
      ),
      timeout,
    ])
    const row = result.data[0]
    if (!row) return STANDALONE_TOPOLOGY
    return { cluster: row.cluster, shardNum: row.shard_num }
  } catch {
    return STANDALONE_TOPOLOGY
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Weight each host in `topologies` (same order as the input connections).
 * Standalone hosts (null cluster/shard) are always {@link PRIMARY_HOST_WEIGHT}.
 * Among hosts sharing the same `cluster:shardNum` key, the first occurrence in
 * input order is {@link PRIMARY_HOST_WEIGHT} and every later one is
 * {@link REPLICA_HOST_WEIGHT}. Pure — no I/O, easy to unit test independent of
 * the live probe.
 */
export function computeHostWeights(topologies: HostTopology[]): number[] {
  const seenShards = new Set<string>()
  return topologies.map(({ cluster, shardNum }) => {
    if (cluster == null || shardNum == null) return PRIMARY_HOST_WEIGHT
    const key = `${cluster}:${shardNum}`
    if (seenShards.has(key)) return REPLICA_HOST_WEIGHT
    seenShards.add(key)
    return PRIMARY_HOST_WEIGHT
  })
}
