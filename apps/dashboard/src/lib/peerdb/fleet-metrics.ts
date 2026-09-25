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
  /**
   * Names of terminated mirrors. `normalizeFleetStatus` has always bucketed
   * these, but nothing alerted on them — unlike `STATUS_FAILED` — so a torn-down
   * pipeline looked identical to a healthy one.
   */
  terminatedMirrors: string[]
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
  terminatedMirrors: [],
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

/** The single replication slot holding the most unreplicated WAL. */
export interface PeerDBWorstSlot {
  /** Peer (mirror/flow) the slot belongs to. */
  peer: string
  /** Slot name, or `null` when upstream did not report one. */
  slotName: string | null
  lagInMb: number
  /** `peer/slot` display label — the same string as `maxSlotLagLabel`. */
  label: string
}

/**
 * Locate the worst-lagging replication slot across every peer.
 *
 * Single source of truth for "which slot is worst": {@link summarizePeerDBFleet}
 * derives `maxSlotLagMb` / `maxSlotLagLabel` from it, and the insight collector
 * uses the `peer` + `slotName` to fetch that one slot's lag history (which it
 * could not do from the display label alone). Returns `null` when no slot
 * reported a finite lag. Never throws.
 */
export function worstSlotRef(
  slots: readonly PeerDBFleetSlotInput[]
): PeerDBWorstSlot | null {
  let worst: PeerDBWorstSlot | null = null
  for (const entry of slots ?? []) {
    for (const slot of entry?.slots ?? []) {
      const lag = toNum(slot?.lagInMb)
      if (lag === null) continue
      if (worst !== null && lag <= worst.lagInMb) continue
      const slotName =
        typeof slot?.slotName === 'string' && slot.slotName
          ? slot.slotName
          : null
      worst = {
        peer: entry?.name ?? '',
        slotName,
        lagInMb: lag,
        label: `${entry?.name ?? ''}${slotName ? `/${slotName}` : ''}`,
      }
    }
  }
  return worst
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
    const terminatedMirrors: string[] = []
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
      else if (bucket === 'paused') pausedMirrors.push(name)
      else if (bucket === 'terminated') terminatedMirrors.push(name)
      if (m.isCdc === true) cdcMirrors += 1
      else if (m.isCdc === false) qrepMirrors += 1
    }

    const worst = worstSlotRef(input.slots ?? [])
    const maxSlotLagMb = worst?.lagInMb ?? null
    const maxSlotLagLabel = worst ? worst.label : null

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
      terminatedMirrors,
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
