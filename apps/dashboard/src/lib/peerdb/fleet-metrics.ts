/**
 * Pure PeerDB fleet-metrics summarizer.
 *
 * Aggregates already-fetched, read-only PeerDB payloads (mirror list, per-mirror
 * status, replication-slot info) into a small fleet-health summary shared by the
 * `GET /api/v1/peerdb-metrics` endpoint and the PeerDB insight collectors.
 *
 * Pure (no fetch / env I/O) so it is unit-tested without a live PeerDB
 * deployment. All inputs are optional/defensive — PeerDB JSON casing varies
 * across versions and any subset of the upstream calls may have failed.
 */

import type { MirrorListItem, MirrorStatusResponse, SlotInfo } from './types'

/** Status buckets for the fleet overview. */
export type PeerDBFleetStatusCounts = Record<string, number>

export interface PeerDBFleetSlotInput {
  /** Mirror/peer the slot belongs to (for the worst-offender label). */
  name: string
  slots: SlotInfo[]
}

export interface PeerDBFleetInput {
  mirrors?: MirrorListItem[] | null
  /** Per-mirror status keyed by mirror name. */
  statuses?: ReadonlyMap<string, MirrorStatusResponse> | null
  /** Replication slots per mirror/peer. */
  slots?: PeerDBFleetSlotInput[] | null
  /** Total rows synced per mirror (from total_rows_synced), keyed by name. */
  rowsSynced?: ReadonlyMap<string, number> | null
}

export interface PeerDBFleetMetrics {
  /** Total mirrors seen in the list response. */
  totalMirrors: number
  /** Mirrors by normalized status bucket (`running`, `failed`, `paused`, …). */
  byStatus: PeerDBFleetStatusCounts
  /** Names of failed mirrors (STATUS_FAILED / STATUS_TERMINATED with error). */
  failedMirrors: string[]
  /** Names of paused/pausing mirrors. */
  pausedMirrors: string[]
  /** CDC vs QRep split (from `isCdc`). */
  cdcMirrors: number
  qrepMirrors: number
  /** Worst replication-slot lag across the fleet, MiB (null when unknown). */
  maxSlotLagMb: number | null
  /** `mirror/slot` label holding the worst lag, when known. */
  maxSlotLagLabel: string | null
  /** Sum of per-mirror rows-synced readings (null when none reported). */
  totalRowsSynced: number | null
}

const EMPTY: PeerDBFleetMetrics = {
  totalMirrors: 0,
  byStatus: {},
  failedMirrors: [],
  pausedMirrors: [],
  cdcMirrors: 0,
  qrepMirrors: 0,
  maxSlotLagMb: null,
  maxSlotLagLabel: null,
  totalRowsSynced: null,
}

/** Normalize a FlowStatus enum string to a fleet-overview bucket. */
export function normalizeFleetStatus(status: unknown): string {
  const s = String(status ?? '').toUpperCase()
  if (s.includes('FAILED')) return 'failed'
  if (s.includes('PAUS') || s.includes('PAUSING')) return 'paused'
  if (s.includes('RUNNING')) return 'running'
  if (s.includes('SNAPSHOT') || s.includes('SETUP')) return 'snapshot'
  if (s.includes('TERMINAT')) return 'terminated'
  return 'unknown'
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Summarize already-fetched PeerDB payloads into fleet metrics. Never throws —
 * malformed input yields the empty summary.
 */
export function summarizePeerDBFleet(
  input: PeerDBFleetInput = {}
): PeerDBFleetMetrics {
  try {
    const mirrors = Array.isArray(input.mirrors) ? input.mirrors : []
    const byStatus: PeerDBFleetStatusCounts = {}
    const failedMirrors: string[] = []
    const pausedMirrors: string[] = []
    let cdcMirrors = 0
    let qrepMirrors = 0

    for (const m of mirrors) {
      const name = typeof m?.name === 'string' ? m.name : ''
      if (!name) continue
      const status =
        input.statuses?.get(name)?.currentFlowState ?? m.status ?? 'unknown'
      const bucket = normalizeFleetStatus(status)
      byStatus[bucket] = (byStatus[bucket] ?? 0) + 1
      if (bucket === 'failed') failedMirrors.push(name)
      if (bucket === 'paused') pausedMirrors.push(name)
      if (m.isCdc === true) cdcMirrors += 1
      else if (m.isCdc === false) qrepMirrors += 1
    }

    let maxSlotLagMb: number | null = null
    let maxSlotLagLabel: string | null = null
    for (const entry of input.slots ?? []) {
      for (const slot of entry?.slots ?? []) {
        const lag = toNum(slot?.lagInMb)
        if (lag === null) continue
        if (maxSlotLagMb === null || lag > maxSlotLagMb) {
          maxSlotLagMb = lag
          const slotName =
            typeof slot?.slotName === 'string' && slot.slotName
              ? `/${slot.slotName}`
              : ''
          maxSlotLagLabel = `${entry.name}${slotName}`
        }
      }
    }

    let totalRowsSynced: number | null = null
    if (input.rowsSynced) {
      let sum = 0
      let seen = false
      for (const v of input.rowsSynced.values()) {
        if (Number.isFinite(v)) {
          sum += v
          seen = true
        }
      }
      totalRowsSynced = seen ? sum : null
    }

    return {
      totalMirrors: mirrors.filter((m) => typeof m?.name === 'string' && m.name)
        .length,
      byStatus,
      failedMirrors,
      pausedMirrors,
      cdcMirrors,
      qrepMirrors,
      maxSlotLagMb,
      maxSlotLagLabel,
      totalRowsSynced,
    }
  } catch {
    return { ...EMPTY, byStatus: {} }
  }
}
