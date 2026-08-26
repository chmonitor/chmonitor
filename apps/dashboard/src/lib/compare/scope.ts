export type CompareScope = 'hosts' | 'nodes'

export type ComparePeer = { id: number; name: string }

export function parseCompareScope(
  raw: string | null | undefined
): CompareScope | undefined {
  if (raw === 'hosts' || raw === 'nodes') return raw
  return undefined
}

export function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

/**
 * Prefer an explicit scope when that side has a pair. Otherwise hosts if two
 * saved connections exist, else cluster nodes, else hosts (the UI shows the
 * example preview when neither side has a pair).
 */
export function resolveCompareScope(opts: {
  hostCount: number
  nodeCount: number
  requested?: CompareScope
}): CompareScope {
  const { hostCount, nodeCount, requested } = opts
  if (requested === 'nodes' && nodeCount >= 2) return 'nodes'
  if (requested === 'hosts' && hostCount >= 2) return 'hosts'
  if (hostCount >= 2) return 'hosts'
  if (nodeCount >= 2) return 'nodes'
  return 'hosts'
}

export function resolvePair(
  peers: ComparePeer[],
  source?: number,
  target?: number
): { sourceId: number; targetId: number } | null {
  if (peers.length < 2) return null
  const ids = new Set(peers.map((p) => p.id))
  const sourceId =
    source !== undefined && ids.has(source) ? source : peers[0].id
  const fallbackPeer =
    peers.find((p) => p.id !== sourceId) ?? peers.find((_, i) => i !== 0)
  if (!fallbackPeer) return null
  const fallback = fallbackPeer.id
  const targetId =
    target !== undefined && ids.has(target) && target !== sourceId
      ? target
      : fallback
  return { sourceId, targetId }
}

export function canComparePair(hostCount: number, nodeCount: number): boolean {
  return hostCount >= 2 || nodeCount >= 2
}
