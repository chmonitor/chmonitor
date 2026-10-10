/**
 * PeerDB log-pattern alerting (#3700, split from #3675 section C).
 *
 * Per-mirror alerts dedup under `peerdb-mirror-health:<flow-slug>`, so one
 * root cause across 40 mirrors used to mean 40 alerts. This module groups the
 * ERROR-log messages the collector already read by
 * {@link fingerprintLogMessage} and yields ONE condition per pattern, keyed
 * `peerdb-log-pattern:<stable hash of fingerprint>`, listing the affected
 * mirrors and the count.
 *
 * Pure: no I/O, no store writes. The cycle (`./alert-cycle`) decides delivery
 * from the persisted alert state, which doubles as the "seen" set — a pattern
 * with a firing record has been seen; recovery clears the record (existing
 * `decideNotification` semantics), so a pattern that comes back is new again.
 */

import type { AlertStateRecord } from '@/lib/health/alert-state-store'

import { fingerprintLogMessage } from './log-fingerprint'

/** Base rule id; each pattern dedups under `<base>:<hash>`. */
export const PEERDB_LOG_PATTERN_RULE_ID = 'peerdb-log-pattern'

/**
 * ERROR entries of one pattern in a single tick at which the pattern escalates
 * to a critical "rate spike". The collector reads at most 100 ERROR rows per
 * mirror, so this counts rows across the whole fleet's sampled pages.
 */
export const PEERDB_LOG_PATTERN_SPIKE_COUNT = 50

/** Patterns evaluated per tick, busiest first — bounds the fan-out. */
export const PEERDB_LOG_PATTERN_MAX_PATTERNS = 20

/** Mirrors named in a label before collapsing to `+N more`. */
export const PEERDB_LOG_PATTERN_MAX_MIRRORS_LISTED = 10

/** Longest fingerprint carried into a title/label. */
const MAX_PATTERN_CHARS = 160

export interface PeerDBLogPattern {
  ruleId: string
  fingerprint: string
  /** ERROR entries matching this pattern this tick. */
  count: number
  /** Distinct affected mirrors, sorted. */
  mirrors: string[]
}

/** FNV-1a 32-bit, hex. Stable across runtimes and process restarts. */
export function hashLogFingerprint(fingerprint: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < fingerprint.length; i++) {
    h ^= fingerprint.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function peerDBLogPatternRuleId(fingerprint: string): string {
  return `${PEERDB_LOG_PATTERN_RULE_ID}:${hashLogFingerprint(fingerprint)}`
}

/**
 * Group raw ERROR messages by fingerprint. Messages that normalize to `''`
 * are dropped. Busiest pattern first, capped at
 * {@link PEERDB_LOG_PATTERN_MAX_PATTERNS}.
 */
export function groupPeerDBErrorPatterns(
  entries: ReadonlyArray<{ flowName: string; message: string }>
): PeerDBLogPattern[] {
  const byFp = new Map<string, { count: number; mirrors: Set<string> }>()
  for (const e of entries) {
    const fp = fingerprintLogMessage(e.message)
    if (fp === '') continue
    const g = byFp.get(fp) ?? { count: 0, mirrors: new Set<string>() }
    g.count++
    g.mirrors.add(e.flowName)
    byFp.set(fp, g)
  }
  return [...byFp.entries()]
    .map(([fingerprint, g]) => ({
      ruleId: peerDBLogPatternRuleId(fingerprint),
      fingerprint,
      count: g.count,
      mirrors: [...g.mirrors].sort(),
    }))
    .sort(
      (a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint)
    )
    .slice(0, PEERDB_LOG_PATTERN_MAX_PATTERNS)
}

/**
 * Whether a present pattern should be dispatched this tick:
 * - `spike` (critical) when `count >= spikeCount`, every tick — the shared
 *   dedup/cooldown in `dispatchFinding` keeps that to one notification;
 * - `new` (warning) when the pattern is not currently firing (no record, or a
 *   record still confirming via hysteresis);
 * - `null` when it is already firing below the spike threshold: it was
 *   reported once and is not re-sent every tick.
 */
export function decidePeerDBLogPatternAlert(
  pattern: Pick<PeerDBLogPattern, 'count'>,
  prev: AlertStateRecord | undefined,
  spikeCount: number = PEERDB_LOG_PATTERN_SPIKE_COUNT
): 'new' | 'spike' | null {
  if (pattern.count >= spikeCount) return 'spike'
  if (!prev || prev.severity === 'ok') return 'new'
  return null
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function formatPeerDBLogPatternTitle(
  pattern: PeerDBLogPattern,
  kind: 'new' | 'spike'
): string {
  const what = kind === 'spike' ? 'PeerDB error spike' : 'New PeerDB error'
  return `${what}: ${clip(pattern.fingerprint, 80)}`
}

export function formatPeerDBLogPatternLabel(pattern: PeerDBLogPattern): string {
  const shown = pattern.mirrors.slice(0, PEERDB_LOG_PATTERN_MAX_MIRRORS_LISTED)
  const more = pattern.mirrors.length - shown.length
  const n = pattern.mirrors.length
  return `${pattern.count} error${pattern.count === 1 ? '' : 's'} across ${n} mirror${n === 1 ? '' : 's'} (${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}): ${clip(pattern.fingerprint, MAX_PATTERN_CHARS)}`
}
