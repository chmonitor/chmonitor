/**
 * Smart alert-rule suggestion engine (issue #2667).
 *
 * The dashboard already has every signal needed to PROPOSE alert rules — it
 * just never did. This module analyzes per-host live behaviour and emits
 * suggested custom rules, each with a human reason + proposed thresholds.
 *
 * ## Hard invariant (read before touching)
 *
 * Every suggestion compiles to a metric in {@link METRIC_CATALOG} (the vetted,
 * no-SQL rule builder) — NEVER raw SQL. Accepting a suggestion goes through the
 * exact same `createCustomRule` → `compileCustomRule` path the RuleBuilderPanel
 * uses, so an accepted suggestion is indistinguishable from a hand-built rule.
 * The engine can therefore only ever propose thresholds on a fixed, reviewable
 * set of metrics.
 *
 * ## Structure
 *
 * The scoring is a PURE function ({@link buildSuggestions}) over already-gathered
 * signals, so every heuristic is unit-testable without a database or a cluster.
 * {@link computeAlertSuggestions} is the thin I/O orchestrator that gathers those
 * signals (current metric values, statistical baselines, cluster shape, recurring
 * insight findings) per host and filters out dismissed keys.
 *
 * Four signal sources, all mapped to catalog metrics:
 *  1. near-threshold — a metric currently sitting at >70% of a sensible default
 *     warning threshold, with no rule enabled yet.
 *  2. baseline       — a fitted mean+stddev → warning ≈ p95 (mean+2σ),
 *     critical ≈ p99 (mean+3σ).
 *  3. cluster-shape  — replicated cluster with no replication alert, disks with
 *     no disk-usage alert, etc.
 *  4. recurring      — an insight finding that maps to a catalog metric and has
 *     recurred, suggesting it be codified as a hard rule.
 */

import type { MetricKey } from './rule-builder-schema'

import { METRIC_CATALOG } from './rule-builder-schema'

/** Where a suggestion came from (drives the reason text + de-dup priority). */
export type SuggestionSource =
  | 'recurring-finding'
  | 'baseline'
  | 'near-threshold'
  | 'cluster-shape'

/** Priority when the same metric fires from multiple sources (lower wins). */
const SOURCE_PRIORITY: Record<SuggestionSource, number> = {
  'recurring-finding': 0,
  baseline: 1,
  'near-threshold': 2,
  'cluster-shape': 3,
}

export interface AlertSuggestion {
  /** Stable key: `${metric}:host:${hostId}`. Dismissals persist on this. */
  key: string
  metric: MetricKey
  /** Human title for the card, e.g. "Alert on replication lag". */
  title: string
  /** Why we're proposing this (deterministic, LLM-free). */
  reason: string
  source: SuggestionSource
  op: '>' | '>=' | '<' | '<='
  warning: number
  critical: number
  unit: string
  hostId: number
  hostName: string
  /** The metric's current value, when we sampled one (for display). */
  currentValue: number | null
}

/**
 * Sensible default thresholds per catalog metric. Reuse the built-in rule
 * defaults where a matching built-in exists (so a suggestion and its built-in
 * cousin agree), and pick conservative operational values for the rest. Every
 * catalog metric is "higher = worse", so the operator is always `>=`.
 */
export const METRIC_SUGGESTION_DEFAULTS: Record<
  MetricKey,
  { warning: number; critical: number }
> = {
  'active-mutations': { warning: 20, critical: 100 },
  'failed-mutations': { warning: 1, critical: 5 },
  'parts-per-partition-max': { warning: 200, critical: 300 },
  'readonly-replicas': { warning: 1, critical: 3 },
  'replication-max-lag': { warning: 30, critical: 300 },
  'replication-queue-max': { warning: 20, critical: 100 },
  'disk-usage-percent': { warning: 80, critical: 95 },
  'running-queries': { warning: 100, critical: 200 },
  'long-running-queries': { warning: 1, critical: 5 },
  'stuck-merges': { warning: 1, critical: 3 },
}

/** Replication-related catalog metrics — suggested when the cluster replicates. */
const REPLICATION_METRICS: readonly MetricKey[] = [
  'replication-max-lag',
  'readonly-replicas',
  'replication-queue-max',
]

/** A single fitted baseline, already resolved to a catalog metric key. */
export interface BaselineSignal {
  mean: number
  stddev: number
  sampleCount: number
}

/** A recurring insight finding, already resolved to a catalog metric key. */
export interface RecurringFindingSignal {
  /** How many times this finding recurred over the lookback. */
  count: number
  /** Most recent finding title (used verbatim in the reason). */
  lastTitle: string
}

/** Cluster shape probe result (see traffic-cluster-shape idiom). */
export interface ClusterShape {
  /** Number of rows in system.replicas (>0 ⇒ cluster replicates). */
  replicatedTables: number
  /** Number of configured disks (>1 ⇒ likely tiered storage). */
  disks: number
}

/** Everything the pure scorer needs for one host. */
export interface HostSignals {
  hostId: number
  hostName: string
  /** Catalog metrics that ALREADY have a custom rule — never re-suggested. */
  existingRuleMetrics: ReadonlySet<MetricKey>
  clusterShape: ClusterShape | null
  /** Latest sampled value per catalog metric (point-in-time probe). */
  metricValues: Partial<Record<MetricKey, number>>
  baselines: Partial<Record<MetricKey, BaselineSignal>>
  recurringFindings: Partial<Record<MetricKey, RecurringFindingSignal>>
}

/** Fraction of the default warning threshold that counts as "approaching". */
export const NEAR_THRESHOLD_FRACTION = 0.7

/** A baseline needs at least this many samples before we trust its shape. */
const MIN_BASELINE_SAMPLES = 30

function suggestionKey(metric: MetricKey, hostId: number): string {
  return `${metric}:host:${hostId}`
}

/** Round a proposed threshold to a clean, human-facing number. */
function roundThreshold(v: number): number {
  if (!Number.isFinite(v)) return 0
  const abs = Math.abs(v)
  if (abs >= 100) return Math.round(v)
  if (abs >= 10) return Math.round(v * 10) / 10
  return Math.round(v * 100) / 100
}

function titleFor(metric: MetricKey): string {
  return `Alert on ${METRIC_CATALOG[metric].label.toLowerCase()}`
}

/**
 * Build baseline thresholds: warning ≈ p95 (mean + 2σ), critical ≈ p99
 * (mean + 3σ). Never propose a threshold below the metric's default warning —
 * a baseline of "always ~0" shouldn't yield a rule that fires on the first
 * blip. Returns null when the baseline is too thin or the fit is degenerate.
 */
function baselineThresholds(
  metric: MetricKey,
  baseline: BaselineSignal
): { warning: number; critical: number } | null {
  if (baseline.sampleCount < MIN_BASELINE_SAMPLES) return null
  if (!(baseline.stddev > 0)) return null

  const floor = METRIC_SUGGESTION_DEFAULTS[metric].warning
  const warning = roundThreshold(
    Math.max(baseline.mean + 2 * baseline.stddev, floor)
  )
  let critical = roundThreshold(baseline.mean + 3 * baseline.stddev)
  // Keep the direction sane: critical must be at least as extreme as warning.
  if (critical <= warning) critical = roundThreshold(warning * 1.5)
  return { warning, critical }
}

/**
 * Pure scorer: turn gathered per-host signals into de-duplicated suggestions.
 *
 * At most ONE suggestion per (metric, host) survives — when several sources
 * point at the same metric, the highest-priority source wins (recurring finding
 * > baseline > near-threshold > cluster-shape). Deterministic and side-effect
 * free, so the whole heuristic surface is unit-testable.
 */
export function buildSuggestions(
  hosts: readonly HostSignals[]
): AlertSuggestion[] {
  const out: AlertSuggestion[] = []

  for (const host of hosts) {
    // Collect candidate suggestions per metric, then keep the best-priority one.
    const byMetric = new Map<MetricKey, AlertSuggestion>()

    const consider = (candidate: AlertSuggestion) => {
      const existing = byMetric.get(candidate.metric)
      if (
        !existing ||
        SOURCE_PRIORITY[candidate.source] < SOURCE_PRIORITY[existing.source]
      ) {
        byMetric.set(candidate.metric, candidate)
      }
    }

    const base = (
      metric: MetricKey,
      source: SuggestionSource,
      thresholds: { warning: number; critical: number },
      reason: string
    ): AlertSuggestion => ({
      key: suggestionKey(metric, host.hostId),
      metric,
      title: titleFor(metric),
      reason,
      source,
      op: '>=',
      warning: thresholds.warning,
      critical: thresholds.critical,
      unit: METRIC_CATALOG[metric].unit,
      hostId: host.hostId,
      hostName: host.hostName,
      currentValue: host.metricValues[metric] ?? null,
    })

    for (const metric of Object.keys(METRIC_CATALOG) as MetricKey[]) {
      if (host.existingRuleMetrics.has(metric)) continue

      const defaults = METRIC_SUGGESTION_DEFAULTS[metric]

      // 1. Recurring insight finding mapped to this metric.
      const recurring = host.recurringFindings[metric]
      if (recurring && recurring.count >= 2) {
        consider(
          base(
            metric,
            'recurring-finding',
            defaults,
            `Flagged ${recurring.count} times recently in insights (“${recurring.lastTitle}”). Codify it as a rule so it pages instead of just showing up in the feed.`
          )
        )
      }

      // 2. Statistical baseline → p95/p99 thresholds.
      const baseline = host.baselines[metric]
      if (baseline) {
        const th = baselineThresholds(metric, baseline)
        if (th) {
          consider(
            base(
              metric,
              'baseline',
              th,
              `Learned baseline over recent samples (mean ${roundThreshold(baseline.mean)}${METRIC_CATALOG[metric].unit}, σ ${roundThreshold(baseline.stddev)}). Proposed warning ≈ p95, critical ≈ p99.`
            )
          )
        }
      }

      // 3. Near-threshold: currently sitting close to a sensible default.
      const value = host.metricValues[metric]
      if (
        typeof value === 'number' &&
        value > 0 &&
        value >= NEAR_THRESHOLD_FRACTION * defaults.warning
      ) {
        consider(
          base(
            metric,
            'near-threshold',
            defaults,
            `Currently ${roundThreshold(value)} ${METRIC_CATALOG[metric].unit} — within ${Math.round(NEAR_THRESHOLD_FRACTION * 100)}% of a typical warning threshold of ${defaults.warning}. Enable an alert before it breaches.`
          )
        )
      }

      // 4. Cluster-shape aware.
      const shape = host.clusterShape
      if (shape) {
        if (
          REPLICATION_METRICS.includes(metric) &&
          shape.replicatedTables > 0
        ) {
          consider(
            base(
              metric,
              'cluster-shape',
              defaults,
              `This cluster has ${shape.replicatedTables} replicated table(s) but no ${METRIC_CATALOG[metric].label.toLowerCase()} alert. Replicated clusters should watch this.`
            )
          )
        }
        if (metric === 'disk-usage-percent' && shape.disks > 1) {
          consider(
            base(
              metric,
              'cluster-shape',
              defaults,
              `Multiple storage volumes detected (${shape.disks} disks, likely tiered storage) with no disk-usage alert. Watch worst-case utilization so part moves don't fill a volume unnoticed.`
            )
          )
        }
      }
    }

    for (const suggestion of byMetric.values()) out.push(suggestion)
  }

  return out
}
