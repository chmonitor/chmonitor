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
import type { PeerDBRule } from './alert-rules'
import type {
  PeerDBAlertThresholds,
  PeerDBClassification,
  PeerDBFiringClassification,
  PeerDBInvestigation,
  PeerDBMirrorSignal,
} from './alerting'
import type { PeerDBSweepCoverage } from './sweep-coverage'

import { mutingPeerDBRule, thresholdsForMirror } from './alert-rules'
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
import {
  decidePeerDBLogPatternAlert,
  formatPeerDBLogPatternLabel,
  formatPeerDBLogPatternTitle,
  groupPeerDBErrorPatterns,
  PEERDB_LOG_PATTERN_RULE_ID,
  PEERDB_LOG_PATTERN_SPIKE_COUNT,
} from './log-pattern-alerts'
import { formatSweepCoverage, summarizeSweepCoverage } from './sweep-coverage'
import {
  computePeerDBThroughput,
  healthDbThroughputStore,
  type PeerDBThroughputStore,
} from './throughput-samples'
import { debug } from '@chm/logger'
import { alertStateStore } from '@/lib/health/alert-state-store'

/** Pseudo-host id for PeerDB conditions (ClickHouse hosts are 0..n). */
export const PEERDB_ALERT_HOST_ID = -1

/** Base rule id; per-mirror conditions dedup under `<base>:<flow-slug>`. */
export const PEERDB_ALERT_RULE_ID = 'peerdb-mirror-health'

/** Rule type carried into route matching (glob `*` / `peerdb*` catch-alls). */
export const PEERDB_ALERT_RULE_TYPE = 'peerdb'

/**
 * Fleet-level rule for the PeerDB API itself (#3675). Fires when
 * `GET /v1/mirrors/list` fails (unreachable, auth failed, upstream error) and
 * recovers on the first tick the list call succeeds again. One stable dedup
 * key for the whole deployment, so an outage is one incident, not one per
 * mirror — and never a silent `skipped`.
 */
export const PEERDB_API_HEALTH_RULE_ID = 'peerdb-api-health'

/** Host name the API-health finding is reported under. */
export const PEERDB_API_HEALTH_HOST_NAME = 'peerdb'

/**
 * Flow label used by the fleet-level coverage audit row, so a partial sweep is
 * attributable to the fleet rather than to one mirror.
 */
const PEERDB_FLEET_AUDIT_FLOW = '(fleet)'

/**
 * Decision kind of the coverage audit row (#3687). Emitted whenever the
 * collection read fewer mirrors than PeerDB listed — an operator reading alert
 * history sees the exact shortfall instead of a tick that looks complete.
 */
export const PEERDB_COVERAGE_PARTIAL_DECISION = 'peerdb-coverage:partial'

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
  /**
   * Mirrors the collection actually read a status for this cycle (feeds the
   * sweep summary's `checksRun`). A mirror that failed a read still counts; one
   * the sweep never reached does not.
   */
  mirrorsChecked: number
  /** Mirrors PeerDB listed this cycle, before any bound (#3687). */
  mirrorsListed: number
  /**
   * `mirrorsListed > mirrorsChecked`: this cycle did not see the whole fleet,
   * so "nothing fired" cannot be read as "the fleet is healthy". Also recorded
   * as an `alert_events` audit row and must be carried into any sweep output.
   */
  partial: boolean
  /** `mirrorsListed - mirrorsChecked` — mirrors with no signal at all. */
  unchecked: number
  /** Non-ok findings, shaped like sweep findings for the summary. */
  findings: PeerDBCycleFinding[]
  /** Mirrors for which dispatch was actually invoked. */
  dispatched: number
  /** Pre-delivery audit rows written. */
  audited: number
  /** Collection/evaluation errors (bounded, never thrown). */
  errored: number
  /**
   * True when there was nothing to evaluate: PeerDB unconfigured, or PeerDB
   * answered with zero mirrors. A FAILED list call is never `skipped` — it is
   * a `peerdb-api-health` finding (#3675).
   */
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
  /** Base thresholds; defaults to `DEFAULT_PEERDB_ALERT_THRESHOLDS`. */
  thresholds?: PeerDBAlertThresholds
  /**
   * Per-mirror rules (#3699): each mirror's thresholds are `thresholds` with
   * its matching rules applied (`thresholdsForMirror`), and a mirror muted by
   * a rule is evaluated and audited but never dispatched. Empty/omitted =
   * every mirror uses `thresholds`.
   */
  rules?: readonly PeerDBRule[]
  /** Default true: evaluate + audit, never dispatch. */
  dryRun?: boolean
  /** Injectable clock for tests. */
  now?: number
  /**
   * Max in-flight per-mirror reads during collection (#3677). Defaults to
   * `PEERDB_SWEEP_CONCURRENCY`; the cycle only forwards it so the bound is
   * injectable in tests and reusable by other callers.
   */
  concurrency?: number
  /**
   * Wall-clock budget for collection (#3677). Defaults to
   * `PEERDB_SWEEP_BUDGET_MS`. Without it, a pool of N over M mirrors at the
   * `PEERDB_FETCH_TIMEOUT_MS` ceiling can still overrun the sweep tick.
   */
  budgetMs?: number
  /**
   * Optional mirror-read guard for collection (defaults to
   * `PEERDB_SWEEP_MAX_MIRRORS`; `null` = no guard). Only forwarded so the
   * bound is injectable in tests and configurable in production (#3687).
   */
  maxMirrors?: number | null
  /**
   * Where the previous `rowsSynced` sample per mirror lives between ticks
   * (#3728). Defaults to `peerdb_throughput_samples` on the shared health
   * DB; `null`, no DB, or a failed read skips the throughput-zero check.
   */
  throughputStore?: PeerDBThroughputStore | null
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
  /** Fleet coverage for this cycle (#3687). */
  coverage: PeerDBSweepCoverage
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
    // Either the read failed, or every mirror was healthy-skipped (#3677) and
    // no ERROR-log read was issued at all. Both mean "no error-count sample":
    // the message must not imply a measured zero.
    notes.push('no error-count sample — message must not claim "0 errors"')
  }

  // Fleet coverage (#3687): an isolated mirror firing is a weaker claim when
  // the cycle could not read the whole fleet, because the mirrors it did not
  // read are equally unaccounted for.
  checks.push(
    `coverage:${input.coverage.checked}/${input.coverage.listed}${
      input.coverage.partial ? '-partial' : ''
    }`
  )
  if (input.coverage.partial) {
    notes.push(
      `partial coverage — ${formatSweepCoverage(input.coverage)}; mirrors outside this tick's read are unaccounted for`
    )
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
// PeerDB API health (#3675 — module-private, runs inside the cycle)
// ---------------------------------------------------------------------------

/**
 * One fleet-level finding for the PeerDB API, through the same
 * audit-before-dispatch path as the per-mirror conditions. Recovery evidence
 * is a successful `GET /v1/mirrors/list`, which is a complete read for this
 * condition, so the partial-read hold does not apply to it — an absent
 * collection (no evidence either way) never reaches this function.
 */
async function evaluatePeerDBApiHealth(
  failure: import('./alert-collector').PeerDBListFailure | null,
  ctx: {
    result: PeerDBCycleResult
    audit: PeerDBAuditFn
    dispatch?: PeerDBDispatchFn
    dryRun: boolean
  }
): Promise<void> {
  const ruleId = PEERDB_API_HEALTH_RULE_ID
  const flowName = PEERDB_FLEET_AUDIT_FLOW
  const title =
    failure?.kind === 'auth'
      ? 'PeerDB API auth failed'
      : 'PeerDB API unreachable'
  const label = failure
    ? `GET /v1/mirrors/list failed: ${failure.label} (${failure.kind})`
    : 'GET /v1/mirrors/list answered'

  if (failure) {
    ctx.result.findings.push({
      hostId: PEERDB_ALERT_HOST_ID,
      hostName: PEERDB_API_HEALTH_HOST_NAME,
      checkId: ruleId,
      title,
      severity: 'critical',
      value: 1,
      label,
    })
  } else {
    // Success only matters as a recovery of a persisted firing state.
    const prev = alertStateStore.get(`${PEERDB_ALERT_HOST_ID}:${ruleId}`)
    if (!prev || prev.severity === 'ok') return
  }

  const severity = failure ? ('error' as const) : ('ok' as const)
  if (ctx.dryRun || !ctx.dispatch) {
    await ctx
      .audit({
        flowName,
        severity,
        decisionKind: 'peerdb-hold:dry-run',
        delivered: false,
        error: failure ? label : 'dry-run',
        channel: 'peerdb',
        value: failure ? 1 : 0,
        hostId: PEERDB_ALERT_HOST_ID,
      })
      .catch(() => {})
    ctx.result.audited++
    return
  }

  // AUDIT-BEFORE-DELIVERY, same contract as the per-mirror path.
  await ctx
    .audit({
      flowName,
      severity,
      decisionKind: 'peerdb-predelivery',
      delivered: false,
      ...(failure ? { error: label } : {}),
      channel: 'peerdb',
      value: failure ? 1 : 0,
      hostId: PEERDB_ALERT_HOST_ID,
    })
    .catch(() => {})
  ctx.result.audited++

  await ctx.dispatch({
    hostId: PEERDB_ALERT_HOST_ID,
    hostName: PEERDB_API_HEALTH_HOST_NAME,
    ruleId,
    ruleType: PEERDB_ALERT_RULE_TYPE,
    ruleTitle: failure ? title : 'PeerDB API',
    severity: failure ? 'critical' : 'ok',
    value: failure ? 1 : 0,
    label,
    warnThreshold: null,
    critThreshold: 1,
  })
  ctx.result.dispatched++
}

// ---------------------------------------------------------------------------
// Log patterns (#3700 — module-private, runs inside the cycle)
// ---------------------------------------------------------------------------

/** Host name the log-pattern findings are reported under. */
export const PEERDB_LOG_PATTERN_HOST_NAME = 'peerdb:log-pattern'

/**
 * One finding per ERROR-log fingerprint, not per mirror: a root cause hitting
 * 40 mirrors is one alert listing them. Fires on a pattern that is not
 * currently firing (`new`, warning) and on a rate spike (critical); stays
 * quiet while a known pattern persists below the spike threshold. The
 * persisted alert state is the seen-set, so it survives restarts through the
 * same D1 hydrate/flush as every other rule.
 *
 * Recovery: a firing pattern absent from this tick dispatches `ok` through
 * the same path — but only when the tick's log picture is complete
 * (`errorLogsComplete`); otherwise the recovery is held and audited, matching
 * the per-mirror partial-read hold.
 */
async function evaluatePeerDBLogPatterns(
  collection: import('./alert-collector').PeerDBSignalCollection,
  ctx: {
    result: PeerDBCycleResult
    audit: PeerDBAuditFn
    dispatch?: PeerDBDispatchFn
    dryRun: boolean
  }
): Promise<void> {
  const patterns = groupPeerDBErrorPatterns(collection.errorLogs)
  const present = new Set(patterns.map((p) => p.ruleId))

  const send = async (params: {
    ruleId: string
    flowName: string
    severity: 'warning' | 'critical' | 'ok'
    title: string
    label: string
    value: number
  }): Promise<void> => {
    const auditSeverity =
      params.severity === 'critical'
        ? ('error' as const)
        : params.severity === 'warning'
          ? ('warning' as const)
          : ('ok' as const)
    if (ctx.dryRun || !ctx.dispatch) {
      await ctx
        .audit({
          flowName: params.flowName,
          severity: auditSeverity,
          decisionKind: 'peerdb-hold:dry-run',
          delivered: false,
          error: 'dry-run',
          channel: 'peerdb',
          value: params.value,
          hostId: PEERDB_ALERT_HOST_ID,
        })
        .catch(() => {})
      ctx.result.audited++
      return
    }
    // AUDIT-BEFORE-DELIVERY, same contract as the per-mirror path.
    await ctx
      .audit({
        flowName: params.flowName,
        severity: auditSeverity,
        decisionKind: 'peerdb-predelivery',
        delivered: false,
        channel: 'peerdb',
        value: params.value,
        hostId: PEERDB_ALERT_HOST_ID,
      })
      .catch(() => {})
    ctx.result.audited++
    await ctx.dispatch({
      hostId: PEERDB_ALERT_HOST_ID,
      hostName: PEERDB_LOG_PATTERN_HOST_NAME,
      ruleId: params.ruleId,
      ruleType: PEERDB_ALERT_RULE_TYPE,
      ruleTitle: params.title,
      severity: params.severity,
      value: params.value,
      label: params.label,
      warnThreshold: 1,
      critThreshold: PEERDB_LOG_PATTERN_SPIKE_COUNT,
    })
    ctx.result.dispatched++
  }

  for (const pattern of patterns) {
    const prev = alertStateStore.get(
      `${PEERDB_ALERT_HOST_ID}:${pattern.ruleId}`
    )
    const kind = decidePeerDBLogPatternAlert(pattern, prev)
    if (kind === null) continue
    const title = formatPeerDBLogPatternTitle(pattern, kind)
    const label = formatPeerDBLogPatternLabel(pattern)
    const severity = kind === 'spike' ? 'critical' : 'warning'
    ctx.result.findings.push({
      hostId: PEERDB_ALERT_HOST_ID,
      hostName: PEERDB_LOG_PATTERN_HOST_NAME,
      checkId: pattern.ruleId,
      title,
      severity,
      value: pattern.count,
      label,
    })
    await send({
      ruleId: pattern.ruleId,
      flowName: PEERDB_FLEET_AUDIT_FLOW,
      severity,
      title,
      label,
      value: pattern.count,
    })
  }

  // Recovery: firing pattern records absent from this tick.
  const prefix = `${PEERDB_ALERT_HOST_ID}:${PEERDB_LOG_PATTERN_RULE_ID}:`
  const firing = [...alertStateStore.entries()]
    .filter(([key, rec]) => key.startsWith(prefix) && rec.severity !== 'ok')
    .map(([key]) => key.slice(`${PEERDB_ALERT_HOST_ID}:`.length))
    .filter((ruleId) => !present.has(ruleId))
  for (const ruleId of firing) {
    if (!collection.errorLogsComplete) {
      await ctx
        .audit({
          flowName: PEERDB_FLEET_AUDIT_FLOW,
          severity: 'ok',
          decisionKind: 'peerdb-hold:recovery-data-unavailable',
          delivered: false,
          error: `recovery held for ${ruleId}: incomplete error-log read`,
          channel: 'peerdb',
          value: 0,
          hostId: PEERDB_ALERT_HOST_ID,
        })
        .catch(() => {})
      ctx.result.audited++
      continue
    }
    await send({
      ruleId,
      flowName: PEERDB_FLEET_AUDIT_FLOW,
      severity: 'ok',
      title: 'PeerDB error pattern',
      label: 'error pattern no longer seen in mirror logs',
      value: 0,
    })
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
    mirrorsListed: 0,
    partial: false,
    unchecked: 0,
    findings: [],
    dispatched: 0,
    audited: 0,
    errored: 0,
    skipped: false,
  }
  try {
    const { collectPeerDBSignals } = await import('./alert-collector')
    const collection = await collectPeerDBSignals(opts.reader, {
      concurrency: opts.concurrency,
      budgetMs: opts.budgetMs,
      maxMirrors: opts.maxMirrors,
    }).catch(() => null)
    // Coverage is recorded from the collection itself, BEFORE the per-mirror
    // loop, so it survives the early no-op returns and reaches both the result
    // and the audit row (#3687).
    if (collection) {
      result.mirrorsChecked = collection.metrics.mirrorsChecked
      result.mirrorsListed = collection.metrics.mirrorsListed
      result.partial = collection.metrics.partial
      result.unchecked = collection.metrics.unchecked
    }
    const baseThresholds = opts.thresholds ?? DEFAULT_PEERDB_ALERT_THRESHOLDS
    const rules = opts.rules ?? []
    const clock = now ?? Date.now()
    const dryRun = opts.dryRun !== false
    const audit: PeerDBAuditFn = opts.audit ?? auditPeerDBAlert

    // PeerDB API health (#3675): fire on a failed list call, recover on a
    // successful one. Runs before the empty-fleet no-op so a zero-mirror
    // deployment can still recover an earlier outage.
    if (collection?.configured) {
      try {
        await evaluatePeerDBApiHealth(collection.listFailure, {
          result,
          audit,
          dispatch: opts.dispatch,
          dryRun,
        })
      } catch (err) {
        result.errored++
        debug(
          '[peerdb-alerts] api-health evaluation failed',
          err instanceof Error ? err.message : String(err)
        )
      }
      if (collection.listFailure) return result
    }

    if (!collection || collection.signals.length === 0) {
      // Distinguish "PeerDB unconfigured" from "configured but empty" only
      // via the metrics: zero collected with zero checked means nothing to do.
      // (A firing-then-vanished mirror cannot recover here — the persistent
      // store keeps its record until a future successful collection clears
      // it; documented limitation, fail-open toward not flapping.)
      result.skipped = true
      return result
    }

    // AUDIT THE COVERAGE, not just the per-mirror decisions (#3687). A partial
    // collection is written as its own fleet-level row, before any mirror is
    // evaluated, so "nothing fired" on a fleet this cycle never fully read is
    // never mistaken for a healthy fleet in alert history. It is a coverage
    // fact, not an incident: no dispatch, no alert state, no severity claim
    // about any individual mirror.
    if (result.partial) {
      await audit({
        flowName: PEERDB_FLEET_AUDIT_FLOW,
        severity: 'warning',
        decisionKind: PEERDB_COVERAGE_PARTIAL_DECISION,
        delivered: false,
        error: formatSweepCoverage(
          summarizeSweepCoverage(result.mirrorsListed, result.mirrorsChecked)
        ),
        channel: 'peerdb',
        value: result.unchecked,
        hostId: PEERDB_ALERT_HOST_ID,
      }).catch(() => {})
      result.audited++
    }

    // No per-mirror cap: every signal the collection produced is evaluated.
    // Truncating here would reintroduce the same invisible-mirror bug one layer
    // up (#3687) — a failing mirror past the cut would fire no alert and leave
    // no row.
    const signals = collection.signals
    result.errored = collection.metrics.errored

    // Fleet firing count first (investigation context, no extra I/O).
    const throughputStore =
      opts.throughputStore === undefined
        ? healthDbThroughputStore
        : opts.throughputStore
    const samples = throughputStore
      ? await throughputStore.load().catch(() => null)
      : null
    const throughput = computePeerDBThroughput(signals, samples, clock)
    if (throughputStore && samples) {
      await throughputStore
        .save(throughput.upserts, throughput.deletes, clock)
        .catch(() => {})
    }
    const classified = signals.map((raw, i) => {
      const signal: PeerDBMirrorSignal = {
        ...raw,
        rowsFlatSec: throughput.flatSec[i] ?? null,
      }
      const thresholds =
        rules.length > 0
          ? thresholdsForMirror(signal.flowName, rules, baseThresholds)
          : baseThresholds
      return {
        signal,
        thresholds,
        classification: classifyPeerDBMirror(signal, thresholds),
      }
    })
    const fleetFiring = classified.filter(
      (c) => c.classification.severity !== 'ok'
    ).length

    for (const { signal, thresholds, classification } of classified) {
      try {
        const message = formatPeerDBAlertMessage(signal, classification)
        const validation = validatePeerDBAlertMessage(message)
        const ruleId = peerDBRuleIdForFlow(signal.flowName)
        const hostName = `peerdb:${signal.flowName.trim().slice(0, 120) || '(unnamed mirror)'}`
        const payload = peerDBPayloadValue(signal, classification, thresholds)
        const { value, warnThreshold } = payload
        // A `severity: warning` rule disables the critical threshold
        // (Infinity); never put that in a payload.
        const critThreshold =
          typeof payload.critThreshold === 'number' &&
          !Number.isFinite(payload.critThreshold)
            ? null
            : payload.critThreshold
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

        // Mute (#3699): still evaluated, reported and audited — never
        // dispatched, recoveries included (a recovery is delivered on the
        // first tick after the mute ends).
        const muting =
          rules.length > 0
            ? mutingPeerDBRule(signal.flowName, rules, clock)
            : null
        if (muting) {
          await audit({
            flowName: signal.flowName,
            severity: classification.severity,
            decisionKind: 'peerdb-hold:muted',
            delivered: false,
            error: `muted by rule ${muting.id} until ${new Date(muting.muteUntil ?? clock).toISOString()}`,
            channel: 'peerdb',
            value,
            hostId: PEERDB_ALERT_HOST_ID,
          }).catch(() => {})
          result.audited++
          continue
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
          coverage: summarizeSweepCoverage(
            collection.metrics.mirrorsListed,
            collection.metrics.mirrorsChecked
          ),
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

    // Log patterns (#3700): one finding per fingerprint, isolated so a failure
    // here never affects the per-mirror results above or the caller's sweep.
    try {
      await evaluatePeerDBLogPatterns(collection, {
        result,
        audit,
        dispatch: opts.dispatch,
        dryRun,
      })
    } catch (err) {
      result.errored++
      debug(
        '[peerdb-alerts] log-pattern evaluation failed',
        err instanceof Error ? err.message : String(err)
      )
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
