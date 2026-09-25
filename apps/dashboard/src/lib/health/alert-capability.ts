/**
 * "Is this health metric already alerting?" — one pure resolver over the three
 * independent sources that can say yes, so the card badge, the detail dialog and
 * the configure form all agree instead of each inventing its own heuristic.
 *
 * Sources, cheapest and most-local first (deliberately ordered so the list is
 * meaningful on a deployment with no server at all):
 *
 * 1. **`threshold`** — a key present in the `health-thresholds` localStorage map.
 *    Purely local, so this resolves on every deployment, including one with no
 *    metadata database at all. The map is sparse: "key present ⇒ the operator
 *    tuned it", which is a stronger claim than "its value happens to differ
 *    from the default" and never has to touch the network.
 * 2. **`rule`** — a custom alert rule (`custom_alert_rules` in D1) whose `metric`
 *    measures the same quantity as this check. `METRIC_CATALOG` keys are the
 *    metric vocabulary, so the match goes through
 *    {@link CHECK_CATALOG_METRIC} — an explicit, reviewed table, never a fuzzy
 *    name comparison.
 * 3. **`state`** — a row in `alert_state` for this exact `ruleId`, i.e. the check
 *    id. The `alert_state` primary key is `(host_id, rule_id)` and `rule_id` is
 *    the `HealthCheckDef.id` (see `alert-state-card.tsx`, which resolves it back
 *    with `HEALTH_CHECKS.find(c => c.id === ruleId)`), so this is a direct key
 *    lookup. Custom rules carry `custom:<uuid>` ids and therefore never match
 *    here — that is what source 2 is for.
 *
 * ## Why the catalog map is explicit and short
 *
 * Most `HEALTH_CHECKS` ids are NOT catalog metric keys, and only a few checks
 * measure byte-for-byte the same quantity as a catalog entry. Mapping by name
 * similarity would be a lie: `max-parts` and `parts-per-partition-max` look
 * alike but the catalog query does not exclude `system` databases, so the two
 * numbers legitimately differ. The omissions are recorded on the entries below
 * so a future reader can see they were considered, not missed.
 */

import type { AlertStateRow } from './alert-state-persist'
import type { MetricKey } from './rule-builder-schema'
import type { ThresholdsMap } from './thresholds-storage'

/**
 * Health check id → `METRIC_CATALOG` key, **only** where the two queries
 * measure the same quantity. Used to (a) recognise an existing custom rule for
 * this metric and (b) let the detail dialog offer "save as a named alert".
 *
 * Verified against both SQL bodies:
 * - `readonly-replicas` — identical (`count() … WHERE is_readonly`).
 * - `failed-mutations` — identical (`countIf(is_done = 0 AND isNotNull(latest_fail_time))`).
 * - `stuck-merges` — identical (`count() … WHERE elapsed > 600`).
 * - `replication-lag` → `replication-max-lag` — identical (`max(absolute_delay)`).
 * - `disk-percent` → `disk-usage-percent` — identical (the same rounded
 *   `(total_space - free_space) * 100 / total_space` expression).
 *
 * Deliberately NOT mapped:
 * - `long-running-queries` — the catalog's `long-running-queries` counts
 *   `elapsed > 300`; the check counts `elapsed > 60 AND is_initial_query`. The
 *   window and the predicate both differ, so a rule created from the catalog
 *   entry would not fire at the check's own threshold.
 * - `max-parts` — the catalog's `parts-per-partition-max` groups across every
 *   database including `system`; the check excludes them. The values diverge.
 */
export const CHECK_CATALOG_METRIC: Readonly<
  Partial<Record<string, MetricKey>>
> = {
  'readonly-replicas': 'readonly-replicas',
  'failed-mutations': 'failed-mutations',
  'stuck-merges': 'stuck-merges',
  'replication-lag': 'replication-max-lag',
  'disk-percent': 'disk-usage-percent',
}

/** Catalog metric for a check, or `null` when nothing measures the same thing. */
export function catalogMetricForCheck(checkId: string): MetricKey | null {
  return CHECK_CATALOG_METRIC[checkId] ?? null
}

/** Which source says this metric is already alerting. */
export type AlertSignalSource = 'threshold' | 'rule' | 'state'

export interface MetricAlertSignals {
  /** True when at least one source fired. */
  configured: boolean
  /** Every source that fired, in cheapest-first order. */
  sources: readonly AlertSignalSource[]
  /** `METRIC_CATALOG` key for this check, when one exists. */
  catalogMetric: MetricKey | null
  /** Last known server-side severity for this `ruleId`, when it has one. */
  lastState: AlertStateRow | null
}

const NO_SIGNALS: MetricAlertSignals = {
  configured: false,
  sources: [],
  catalogMetric: null,
  lastState: null,
}

export interface ResolveMetricAlertSignalsInput {
  /** The `HealthCheckDef.id` — the single identity across the whole alert stack. */
  checkId: string
  /** The sparse `health-thresholds` localStorage map. */
  thresholds: ThresholdsMap
  /** `metric` values of every enabled custom rule, from `GET …/custom-rules`. */
  customRuleMetrics?: readonly string[]
  /** Rows from `GET /api/v1/health/alert-state`. */
  alertStates?: readonly AlertStateRow[]
  /**
   * Restrict the `state` source to one host. Omit to match any host, which is
   * the right answer for the cross-host list a user is actually reasoning about.
   */
  hostId?: number
}

/**
 * Resolve whether a metric already has an alert, and from where.
 *
 * Pure and total: every source is optional, so a caller holding only the
 * localStorage map still gets a truthful `configured` answer — that is what
 * makes the indicator work with no metadata database.
 */
export function resolveMetricAlertSignals({
  checkId,
  thresholds,
  customRuleMetrics,
  alertStates,
  hostId,
}: ResolveMetricAlertSignalsInput): MetricAlertSignals {
  const catalogMetric = catalogMetricForCheck(checkId)
  const sources: AlertSignalSource[] = []

  // 1. localStorage — always available, never needs the network.
  if (Object.hasOwn(thresholds, checkId)) sources.push('threshold')

  // 2. A custom rule bound to the catalog metric that measures the same thing.
  if (
    catalogMetric !== null &&
    customRuleMetrics?.some((metric) => metric === catalogMetric)
  ) {
    sources.push('rule')
  }

  // 3. A live/recorded state row keyed by this very check id. Kept even when
  //    the severity has recovered to `ok` — the row proves the sweep evaluated
  //    this rule for this host, which is the "already configured" fact.
  const lastState =
    alertStates?.find(
      (row) =>
        row.ruleId === checkId &&
        (hostId === undefined || row.hostId === hostId)
    ) ?? null
  if (lastState) sources.push('state')

  if (sources.length === 0) return { ...NO_SIGNALS, catalogMetric }

  return { configured: true, sources, catalogMetric, lastState }
}

/** One-line, user-facing summary of why a metric counts as alerting. */
export function describeAlertSignals(
  signals: MetricAlertSignals
): string | null {
  if (!signals.configured) return null
  const parts: string[] = []
  if (signals.sources.includes('threshold')) parts.push('tuned thresholds')
  if (signals.sources.includes('rule')) parts.push('a named alert rule')
  if (signals.sources.includes('state')) parts.push('recorded alert state')
  return parts.join(' · ')
}
