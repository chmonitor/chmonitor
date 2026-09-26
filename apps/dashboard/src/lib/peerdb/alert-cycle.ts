/**
 * PeerDB alert cycle — the single runtime orchestrator (issue #3413).
 *
 * ONE exported entry point, {@link runPeerDBAlertCycle}, enforces the full
 * lifecycle in order and makes it unskippable (M3): every pipeline step below
 * it is module-private.
 *
 *   collect (read-only, `./alert-collector`)
 *     → classify → format → validate (pure, `./alerting`)
 *     → audit pre-delivery row (`alert_events`, always BEFORE dispatch)
 *     → deterministic investigation (this module, H2)
 *     → persistent dedup + suppression + fan-out (existing sweep
 *       `dispatchFinding` — maintenance / quiet-hours / ACK / routes /
 *       per-channel delivery / per-channel audit all reused, M2+H1)
 *
 * Persistent dedup (M2): the cycle never keeps its own in-memory `seen` set
 * for delivery decisions. It peeks the shared `alertStateStore` (pure read)
 * only to decide whether an `ok` signal is a potential recovery worth
 * auditing. A partial status/log read is held rather than treated as proof of
 * recovery; the actual notify/suppress decision — including cooldown,
 * hysteresis, and restart survival via D1 hydrate/flush — lives in the
 * existing `evaluateAlert` path inside `dispatchFinding`. Multi-instance
 * semantics are therefore identical to the ClickHouse sweep: hydrate at tick
 * start, flush at tick end, last-writer-wins per tick (a cross-instance race
 * may double-deliver rather than drop — fail-open toward delivery).
 *
 * Agent investigation (H2): the sweep NEVER calls an LLM — by design, a cron
 * tick must be deterministic, bounded, and offline-safe. The pre-send
 * investigation here is {@link runDeterministicPeerDBInvestigation}: message
 * revalidation, signal-presence checks, and fleet context (how many other
 * mirrors are firing, fleet slot lag). Interactive, model-driven deep dives
 * remain available to operators through the `get_peerdb_mirror_status` agent
 * tool (#3407, gated by `CHM_FEATURE_PEERDB_AGENT`) — that is the
 * agent-facing contract; this module does not claim an LLM investigation
 * where none exists.
 *
 * Isolation: the whole cycle is wrapped so a PeerDB failure (unconfigured,
 * unreachable, malformed) can never break the ClickHouse sweep around it.
 * Per-connection (`?connection=<id>`) coverage is out of v1.
 */

import type { DispatchFindingParams } from '@/lib/health/sweep/dispatch/types'
import type {
  PeerDBAlertThresholds,
  PeerDBClassification,
  PeerDBFiringClassification,
  PeerDBInvestigation,
  PeerDBMirrorSignal,
} from './alerting'

import {
  auditPeerDBAlert,
  buildPeerDBAlertPayload,
  classifyPeerDBMirror,
  DEFAULT_PEERDB_ALERT_THRESHOLDS,
  formatPeerDBAlertMessage,
  peerDBPayloadValue,
  validatePeerDBAlertMessage,
} from './alerting'
import { peerDBFlowSlug } from './flow-slug'
import { debug } from '@chm/logger'
import { alertStateStore } from '@/lib/health/alert-state-store'

/** Pseudo-host id for PeerDB conditions (ClickHouse hosts are 0..n). */
export const PEERDB_ALERT_HOST_ID = -1

/** Base rule id; per-mirror conditions dedup under `<base>:<flow-slug>`. */
export const PEERDB_ALERT_RULE_ID = 'peerdb-mirror-health'

/** Rule type carried into route matching (glob `*` / `peerdb*` catch-alls). */
export const PEERDB_ALERT_RULE_TYPE = 'peerdb'

/** Cap on mirrors processed per cycle (mirrors the collector bound). */
export const PEERDB_CYCLE_MAX_MIRRORS = 50

/**
 * Stable per-mirror rule id for the persistent dedup store. Slugged so D1
 * keys stay small and glob route patterns (`peerdb-mirror-health*`) match.
 */
export function peerDBRuleIdForFlow(flowName: string): string {
  return `${PEERDB_ALERT_RULE_ID}:${peerDBFlowSlug(flowName)}`
}

/** Dispatch function shape — the sweep's `dispatchFinding` satisfies this. */
export type PeerDBDispatchFn = (params: DispatchFindingParams) => Promise<void>

/** Audit function shape — defaults to the best-effort `auditPeerDBAlert`. */
export type PeerDBAuditFn = (params: {
  flowName: string
  severity: 'warning' | 'error' | 'ok' | 'recovery'
  decisionKind: string
  delivered: boolean
  error?: string
  channel?: string
  value?: number | null
  hostId?: number
}) => Promise<void>

export interface PeerDBCycleFinding {
  hostId: number
  hostName: string
  checkId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
}

export interface PeerDBCycleResult {
  /** Mirrors collected (before classification). */
  mirrorsChecked: number
  /** Non-ok findings, shaped like sweep findings for the summary. */
  findings: PeerDBCycleFinding[]
  /** Mirrors for which dispatch was actually invoked. */
  dispatched: number
  /** Pre-delivery audit rows written. */
  audited: number
  /** Collection/evaluation errors (bounded, never thrown). */
  errored: number
  /** True when PeerDB is unconfigured (cycle no-op). */
  skipped: boolean
}

export interface PeerDBCycleOptions {
  /** Snapshot source; defaults to the env-configured flow-api reader. */
  reader?: Parameters<
    typeof import('./alert-collector').collectPeerDBSignals
  >[0]
  /** Sweep dispatcher; when omitted the cycle evaluates + audits dry-run. */
  dispatch?: PeerDBDispatchFn
  /** Audit sink; defaults to the best-effort `alert_events` writer. */
  audit?: PeerDBAuditFn
  thresholds?: PeerDBAlertThresholds
  /** Default true: evaluate + audit, never dispatch. */
  dryRun?: boolean
  /** Injectable clock for tests. */
  now?: number
}

// ---------------------------------------------------------------------------
// Deterministic investigation (H2 — module-private, runs inside the cycle)
// ---------------------------------------------------------------------------

interface DeterministicInvestigationInput {
  signal: PeerDBMirrorSignal
  classification: PeerDBClassification
  fleetFiring: number
  fleetMaxSlotLagMb: number | null
  signalsCollected: number
  hasLagSample: boolean
  hasErrorSample: boolean
  hasSlotSample: boolean
  now?: number
}

/**
 * Bounded, side-effect-free pre-send investigation. Revalidates the formatted
 * message, requires at least one collected signal (refuses to send blind),
 * holds `ok` classifications (nothing to send), and attaches fleet context
 * so a fleet-wide outage reads differently from an isolated mirror failure.
 * No network, no LLM — see the module docblock for the agent-tool contract.
 */
function runDeterministicPeerDBInvestigation(
  input: DeterministicInvestigationInput
): PeerDBInvestigation {
  const message = formatPeerDBAlertMessage(input.signal, input.classification)
  const validation = validatePeerDBAlertMessage(message)
  const checks: string[] = []
  const notes: string[] = []
  let hold = false

  checks.push(
    validation.ok ? 'message-validation:pass' : 'message-validation:fail'
  )
  if (!validation.ok) {
    hold = true
    notes.push(`message issues: ${validation.issues.join(', ')}`)
  }

  if (input.classification.severity === 'ok') {
    checks.push('severity:ok-no-action')
    hold = true
    notes.push('classification is ok — nothing to send')
  } else {
    checks.push(`severity:${input.classification.severity}`)
  }

  if (input.signalsCollected < 1) {
    checks.push('metrics:missing')
    hold = true
    notes.push('no read-only signals collected — refusing to send blind')
  } else {
    checks.push(`metrics:signals=${input.signalsCollected}`)
  }
  if (!input.hasLagSample) {
    notes.push('no CDC-lag sample — message states lag only if observed')
  }
  if (!input.hasErrorSample) {
    notes.push('error count unavailable — message must say so, not "0 errors"')
  }

  // Fleet context (already-collected — no extra upstream calls).
  checks.push(`fleet-firing:${input.fleetFiring}`)
  if (input.fleetFiring > 1) {
    notes.push(
      `${input.fleetFiring} mirrors firing — possible fleet-wide outage, not an isolated mirror`
    )
  }
  if (input.fleetMaxSlotLagMb !== null) {
    notes.push(`fleet worst slot lag ${Math.round(input.fleetMaxSlotLagMb)}MB`)
  }

  checks.push(`reasons:${input.classification.reasons.join(',') || 'none'}`)

  return {
    investigatedAt: new Date(input.now ?? Date.now()).toISOString(),
    verdict: hold ? 'hold' : 'send',
    checks,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Orchestrator (M3 — the only entry point that can reach delivery)
// ---------------------------------------------------------------------------

/**
 * Run one full PeerDB alert cycle. Never throws — every stage is guarded so
 * a PeerDB failure degrades to `{ errored, skipped }` counters instead of
 * breaking the caller's sweep.
 *
 * Audit-before-delivery is structural: for every mirror that will attempt
 * delivery, a best-effort `peerdb-issue` audit call is awaited BEFORE
 * `dispatch` is invoked. Held/dry-run evaluations get their own audited row
 * with the reason. There is no exported path that reaches `dispatch` without
 * passing through the audit step in this function.
 */
export async function runPeerDBAlertCycle(
  opts: PeerDBCycleOptions = {}
): Promise<PeerDBCycleResult> {
  const now = opts.now
  const result: PeerDBCycleResult = {
    mirrorsChecked: 0,
    findings: [],
    dispatched: 0,
    audited: 0,
    errored: 0,
    skipped: false,
  }
  try {
    const { collectPeerDBSignals } = await import('./alert-collector')
    const collection = await collectPeerDBSignals(opts.reader).catch(() => null)
    if (!collection || collection.signals.length === 0) {
      // Distinguish "PeerDB unconfigured" from "configured but empty" only
      // via the metrics: zero collected with zero checked means nothing to do.
      // (A firing-then-vanished mirror cannot recover here — the persistent
      // store keeps its record until a future successful collection clears
      // it; documented limitation, fail-open toward not flapping.)
      result.skipped = true
      return result
    }

    const thresholds = opts.thresholds ?? DEFAULT_PEERDB_ALERT_THRESHOLDS
    const dryRun = opts.dryRun !== false
    const audit: PeerDBAuditFn = opts.audit ?? auditPeerDBAlert
    const signals = collection.signals.slice(0, PEERDB_CYCLE_MAX_MIRRORS)
    result.mirrorsChecked = collection.metrics.mirrorsChecked
    result.errored = collection.metrics.errored

    // Fleet firing count first (investigation context, no extra I/O).
    const classified = signals.map((signal) => ({
      signal,
      classification: classifyPeerDBMirror(signal, thresholds),
    }))
    const fleetFiring = classified.filter(
      (c) => c.classification.severity !== 'ok'
    ).length

    for (const { signal, classification } of classified) {
      try {
        const message = formatPeerDBAlertMessage(signal, classification)
        const validation = validatePeerDBAlertMessage(message)
        const ruleId = peerDBRuleIdForFlow(signal.flowName)
        const hostName = `peerdb:${signal.flowName.trim().slice(0, 120) || '(unnamed mirror)'}`
        const { value, warnThreshold, critThreshold } = peerDBPayloadValue(
          signal,
          classification,
          thresholds
        )
        const dispatchSeverity =
          classification.severity === 'error'
            ? ('critical' as const)
            : classification.severity === 'warning'
              ? ('warning' as const)
              : ('ok' as const)

        if (classification.severity !== 'ok') {
          result.findings.push({
            hostId: PEERDB_ALERT_HOST_ID,
            hostName,
            checkId: ruleId,
            title: message.title,
            severity: dispatchSeverity as 'warning' | 'critical',
            value,
            label: message.label,
          })
        } else {
          // `ok` signals only matter as potential recoveries: peek the
          // persistent store (pure read, no commit). No record → nothing
          // ever fired → skip silently (no audit row, no dispatch).
          const key = `${PEERDB_ALERT_HOST_ID}:${ruleId}`
          const prev = alertStateStore.get(key)
          if (!prev || prev.severity === 'ok') continue

          // A partial read is not evidence of recovery. In particular, do not
          // clear a persisted incident when the status endpoint failed or the
          // error-log sample is unavailable: either can hide the condition that
          // caused the original firing state. Other available signals may still
          // classify as firing above; this guard applies only to the ok/recovery
          // branch.
          if (
            signal.statusEndpointAvailable === false ||
            signal.errorCountSource === 'unavailable'
          ) {
            const missing = [
              signal.statusEndpointAvailable === false ? 'status' : null,
              signal.errorCountSource === 'unavailable' ? 'error-count' : null,
            ]
              .filter((part): part is string => part !== null)
              .join(',')
            await audit({
              flowName: signal.flowName,
              severity: classification.severity,
              decisionKind: 'peerdb-hold:recovery-data-unavailable',
              delivered: false,
              error: `recovery held: missing ${missing}`,
              channel: 'peerdb',
              value,
              hostId: PEERDB_ALERT_HOST_ID,
            }).catch(() => {})
            result.audited++
            continue
          }
        }

        const investigation = runDeterministicPeerDBInvestigation({
          signal,
          classification,
          fleetFiring,
          fleetMaxSlotLagMb: collection.fleetMaxSlotLagMb,
          signalsCollected: collection.metrics.signalsCollected,
          hasLagSample: collection.metrics.hasLagSample,
          hasErrorSample: collection.metrics.hasErrorSample,
          hasSlotSample: collection.metrics.hasSlotSample,
          now,
        })

        const deliverable =
          !dryRun &&
          validation.ok &&
          investigation.verdict === 'send' &&
          opts.dispatch !== undefined
        // For `ok` (recovery path) the investigation always holds by design
        // ("nothing to send") — but a recovery MUST still reach dispatch so
        // the persistent store can clear it. The recovery intent is exactly:
        // valid + previously firing (checked above) + not dry-run.
        const isRecoveryAttempt =
          classification.severity === 'ok' && !dryRun && validation.ok

        if (!deliverable && !isRecoveryAttempt) {
          const reason = dryRun
            ? 'dry-run'
            : !validation.ok
              ? `validation-failed:${validation.issues.join(',')}`
              : 'investigation-hold'
          await audit({
            flowName: signal.flowName,
            severity: classification.severity,
            decisionKind: `peerdb-hold:${reason}`,
            delivered: false,
            error: reason,
            channel: 'peerdb',
            value,
            hostId: PEERDB_ALERT_HOST_ID,
          }).catch(() => {})
          result.audited++
          continue
        }

        // AUDIT-BEFORE-DELIVERY: this best-effort audit call is awaited before
        // `dispatch` on every path that reaches delivery. The dispatch path
        // then writes its own per-channel outcome rows.
        await audit({
          flowName: signal.flowName,
          severity: classification.severity,
          decisionKind: 'peerdb-predelivery',
          delivered: false,
          channel: 'peerdb',
          value,
          hostId: PEERDB_ALERT_HOST_ID,
        }).catch(() => {})
        result.audited++

        if (opts.dispatch) {
          await opts.dispatch({
            hostId: PEERDB_ALERT_HOST_ID,
            hostName,
            ruleId,
            ruleType: PEERDB_ALERT_RULE_TYPE,
            ruleTitle:
              classification.severity === 'ok'
                ? `PeerDB mirror ${signal.flowName.trim() || '(unnamed mirror)'}`
                : message.title.replace(/^\[(WARNING|ERROR|OK)\]\s*/, ''),
            severity: dispatchSeverity,
            value,
            label: message.label,
            warnThreshold,
            critThreshold,
          })
          result.dispatched++
        }
      } catch (err) {
        result.errored++
        debug(
          `[peerdb-alerts] mirror "${signal.flowName}" evaluation failed`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // Keep the shared AlertPayload contract exercised on the firing path so
    // adapter drift is caught here rather than at 3am: build (not send) one
    // payload per finding. Pure + cheap; failures are counted, never thrown.
    for (const f of result.findings) {
      try {
        const peer = classified.find(
          (c) => peerDBRuleIdForFlow(c.signal.flowName) === f.checkId
        )
        if (peer && peer.classification.severity !== 'ok') {
          buildPeerDBAlertPayload({
            signal: peer.signal,
            classification: peer.classification as PeerDBFiringClassification,
            message: formatPeerDBAlertMessage(peer.signal, peer.classification),
          })
        }
      } catch {
        result.errored++
      }
    }

    return result
  } catch (err) {
    debug(
      '[peerdb-alerts] cycle failed',
      err instanceof Error ? err.message : String(err)
    )
    result.errored++
    return result
  }
}
