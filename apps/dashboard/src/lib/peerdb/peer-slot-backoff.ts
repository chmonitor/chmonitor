/**
 * Per-peer back-off for `GET /v1/peers/slots/<peer>` (#4051 follow-up).
 *
 * A source peer that is down costs a full `PEERDB_FETCH_TIMEOUT_MS` (or a
 * connection-refused error) on EVERY sweep, and each failure logs an error.
 * After {@link PEER_BACKOFF_THRESHOLD} consecutive transport failures the peer
 * is skipped for a window that doubles up to a cap. A skipped peer reads as
 * "no slots" — the same as a failed fetch — so it surfaces as `slotLagMb: null`
 * (unknown), never as a healthy zero.
 *
 * In-memory and per isolate: a restart or a fresh isolate simply probes again.
 */

import type { PeerDBFetchFailure } from './peerdb-config'

export const PEER_BACKOFF_THRESHOLD = 3
export const PEER_BACKOFF_BASE_MS = 5 * 60_000
export const PEER_BACKOFF_CAP_MS = 30 * 60_000
export const PEER_BACKOFF_MAX_PEERS = 256

/**
 * Failure kinds that mean "the peer is not answering". Everything else (auth,
 * 4xx/5xx `upstream`, TLS, a cancelled sweep, no config) is a different
 * problem a retry next tick may fix, so it never counts toward back-off.
 */
const BACKOFF_KINDS: ReadonlySet<PeerDBFetchFailure> = new Set([
  'timeout',
  'refused',
  'dns',
  'network',
])

export function isBackoffFailure(kind: PeerDBFetchFailure): boolean {
  return BACKOFF_KINDS.has(kind)
}

interface PeerState {
  failures: number
  /** Epoch ms until which requests are skipped; 0 = not backing off. */
  until: number
}

export interface PeerBackoffFailure {
  /** True when this failure opened (or extended) a back-off window. */
  backoffStarted: boolean
  windowMs: number
  failures: number
}

export interface PeerSlotBackoff {
  shouldSkip(peer: string): boolean
  /** Record a transport failure for `peer`. */
  recordFailure(peer: string): PeerBackoffFailure
  recordSuccess(peer: string): void
  reset(): void
  size(): number
}

export function createPeerSlotBackoff(
  now: () => number = Date.now,
  limits: { maxPeers?: number } = {}
): PeerSlotBackoff {
  const maxPeers = limits.maxPeers ?? PEER_BACKOFF_MAX_PEERS
  const peers = new Map<string, PeerState>()

  return {
    shouldSkip: (peer) => now() < (peers.get(peer)?.until ?? 0),
    recordFailure: (peer) => {
      const failures = (peers.get(peer)?.failures ?? 0) + 1
      let windowMs = 0
      let until = 0
      if (failures >= PEER_BACKOFF_THRESHOLD) {
        // Each failure past the threshold (the first one after a window
        // expires is the probe) doubles the window: 5 -> 10 -> 20 -> 30 min.
        const step = failures - PEER_BACKOFF_THRESHOLD
        windowMs = Math.min(
          PEER_BACKOFF_BASE_MS * 2 ** step,
          PEER_BACKOFF_CAP_MS
        )
        until = now() + windowMs
      }
      // Re-insert so Map order is least-recently-failed first.
      peers.delete(peer)
      peers.set(peer, { failures, until })
      if (peers.size > maxPeers) {
        const oldest = peers.keys().next().value
        if (oldest !== undefined) peers.delete(oldest)
      }
      return { backoffStarted: windowMs > 0, windowMs, failures }
    },
    recordSuccess: (peer) => {
      peers.delete(peer)
    },
    reset: () => peers.clear(),
    size: () => peers.size,
  }
}

/** Shared by every sweep: the reader is rebuilt per tick, the state must not be. */
export const peerSlotBackoff: PeerSlotBackoff = createPeerSlotBackoff()
