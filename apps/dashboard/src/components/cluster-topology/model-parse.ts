/**
 * Row coercion + node-identity heuristics for building the topology model from
 * raw ClickHouse rows. Pure, no layout/geometry concerns.
 */

import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'
import type { ChNode, KeeperNode, KeeperRole } from './model'

/** Type guard: is this node a Keeper (vs a ClickHouse node)? */
export function isKeeperNode(n: KeeperNode | ChNode): n is KeeperNode {
  return 'role' in n
}

export const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : d
}
export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const truthy = (v: unknown): boolean =>
  v === 1 || v === true || v === '1'

export function deriveKeeperRole(
  isLeader: boolean,
  serverState: string | undefined,
  count: number
): KeeperRole {
  if (isLeader) return 'leader'
  const s = serverState?.toLowerCase()
  if (s === 'leader') return 'leader'
  if (s === 'follower') return 'follower'
  if (s === 'standalone') return 'standalone'
  // observers / learners replicate but never vote — keep them out of quorum math.
  if (s === 'observer' || s === 'learner') return 'observer'
  return count === 1 ? 'standalone' : 'follower'
}

/** Short, stable id for a host (last hostname label or the address). */
export function shortId(host: string, index: number): string {
  const label = host.split('.')[0] || host
  return label || `node-${index}`
}

/** Loopback / non-routable addresses that do NOT uniquely identify a machine. */
export function isLoopbackAddr(addr: string | undefined): boolean {
  if (!addr) return true
  return (
    addr === '::1' ||
    addr === '0.0.0.0' ||
    addr === 'localhost' ||
    addr.startsWith('127.')
  )
}

/** A host_name that is a placeholder for "this server" rather than a real name. */
export function isLoopbackName(name: string): boolean {
  return (
    name === 'localhost' ||
    name === '127.0.0.1' ||
    name === '::1' ||
    name === '0.0.0.0'
  )
}

/**
 * How "descriptive" a host_name is, used to pick the canonical label when several
 * names resolve to ONE physical machine. A real FQDN (`chi-...-0-0.svc...`) beats
 * the implicit `localhost` placeholder so the merged node shows its true name.
 */
export function nameScore(name: string): number {
  let s = 0
  if (!isLoopbackName(name)) s += 100 // a real name always beats localhost
  if (name.includes('.')) s += 10 // FQDN preferred over a bare label
  s += Math.min(name.length, 40) / 100 // longer = more specific (tiny tiebreak)
  return s
}

export function isPhysicalName(name: string): boolean {
  // Heuristic: the implicit per-server clusters and the conventional defaults are
  // "physical"; everything else is treated as a logical/virtual cluster.
  return (
    name === 'default' ||
    name.startsWith('default') ||
    name === 'all-replicated' ||
    name === 'all-sharded'
  )
}

/**
 * A cluster row is part of a Replicated-DATABASE (managed/logical) cluster when
 * it carries the database_* shard/replica names or any of the Replicated-DB
 * health columns (is_active / replication_lag / recovery_time) are non-NULL.
 */
export function isReplicatedDbRow(r: ClusterTopologyRow): boolean {
  return (
    !!r.database_shard_name ||
    !!r.database_replica_name ||
    (r.is_active !== null && r.is_active !== undefined) ||
    (r.replication_lag !== null && r.replication_lag !== undefined) ||
    (r.recovery_time !== null && r.recovery_time !== undefined)
  )
}
