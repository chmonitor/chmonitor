import type { ComparePeer } from '@/lib/compare/scope'
import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'

/**
 * Unique physical cluster nodes from `system.clusters` rows (the same
 * clusters-topology query used on /cluster). Mirrors the machine-identity merge
 * in the topology assembler: is_local rows collapse to one node, and rows that
 * share a routable host_address:port collapse too.
 */
export type ClusterNodePeer = ComparePeer & {
  hostName: string
  hostAddress: string
  port: number
  isLocal: boolean
  aliases: string[]
}

function isLoopbackAddr(addr: string | undefined): boolean {
  if (!addr) return true
  return (
    addr === '::1' ||
    addr === '0.0.0.0' ||
    addr === 'localhost' ||
    addr.startsWith('127.')
  )
}

function isLoopbackName(name: string): boolean {
  return (
    name === 'localhost' ||
    name === '127.0.0.1' ||
    name === '::1' ||
    name === '0.0.0.0'
  )
}

function nameScore(name: string): number {
  let s = 0
  if (!isLoopbackName(name)) s += 100
  if (name.includes('.')) s += 10
  s += Math.min(name.length, 40) / 100
  return s
}

function num(v: unknown, d = 0): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : d
}

function truthy(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}

function hostKey(r: { host_name: string; port: number }): string {
  return `${r.host_name}:${r.port}`
}

export function uniqueClusterNodes(
  rows: ClusterTopologyRow[]
): ClusterNodePeer[] {
  if (rows.length === 0) return []

  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const r of rows) {
    const k = hostKey(r)
    if (!parent.has(k)) parent.set(k, k)
  }

  let localAnchor: string | null = null
  const addrSeen = new Map<string, string>()
  for (const r of rows) {
    const k = hostKey(r)
    if (truthy(r.is_local)) {
      if (localAnchor === null) localAnchor = k
      else union(localAnchor, k)
    }
    if (!isLoopbackAddr(r.host_address)) {
      const ak = `${r.host_address}:${num(r.port)}`
      const prev = addrSeen.get(ak)
      if (prev) union(prev, k)
      else addrSeen.set(ak, k)
    }
  }

  const canonKey = (r: { host_name: string; port: number }) => find(hostKey(r))
  const hostOrder: string[] = []
  const hostMeta = new Map<
    string,
    {
      row: ClusterTopologyRow
      isLocal: boolean
      aliases: Set<string>
    }
  >()

  for (const r of rows) {
    const k = canonKey(r)
    const existing = hostMeta.get(k)
    if (!existing) {
      hostOrder.push(k)
      hostMeta.set(k, {
        row: r,
        isLocal: truthy(r.is_local),
        aliases: new Set([r.host_name, r.host_address].filter(Boolean)),
      })
    } else {
      existing.isLocal = existing.isLocal || truthy(r.is_local)
      existing.aliases.add(r.host_name)
      if (r.host_address) existing.aliases.add(r.host_address)
      if (nameScore(r.host_name) > nameScore(existing.row.host_name)) {
        existing.row = r
      }
    }
  }

  return hostOrder.map((k, i) => {
    const { row, isLocal, aliases } = hostMeta.get(k)!
    const port = num(row.port)
    const hostName = row.host_name
    const name = isLocal
      ? `${hostName} (this node)`
      : port
        ? `${hostName}:${port}`
        : hostName
    return {
      id: i,
      name,
      hostName,
      hostAddress: row.host_address,
      port,
      isLocal,
      aliases: [...aliases],
    }
  })
}

export function rowBelongsToNode(
  nodeHost: string,
  node: ClusterNodePeer
): boolean {
  const needle = nodeHost.toLowerCase()
  return node.aliases.some((alias) => alias.toLowerCase() === needle)
}
