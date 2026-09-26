import type { AlertStateRow } from './alert-state-persist'

import {
  CHECK_CATALOG_METRIC,
  catalogMetricForCheck,
  describeAlertSignals,
  resolveMetricAlertSignals,
} from './alert-capability'
import { METRIC_CATALOG } from './rule-builder-schema'
import { describe, expect, test } from 'bun:test'
import { HEALTH_CHECKS } from '@/components/health/health-checks'

const state = (
  over: Partial<AlertStateRow> & Pick<AlertStateRow, 'ruleId'>
): AlertStateRow => ({
  hostId: 0,
  severity: 'warning',
  updatedAt: 1,
  notifiedAt: 1,
  ...over,
})

describe('catalogMetricForCheck', () => {
  test('maps only checks whose catalog query measures the same quantity', () => {
    expect(catalogMetricForCheck('readonly-replicas')).toBe('readonly-replicas')
    expect(catalogMetricForCheck('failed-mutations')).toBe('failed-mutations')
    expect(catalogMetricForCheck('stuck-merges')).toBe('stuck-merges')
    expect(catalogMetricForCheck('replication-lag')).toBe('replication-max-lag')
    expect(catalogMetricForCheck('disk-percent')).toBe('disk-usage-percent')
  })

  test('every mapped key really exists in METRIC_CATALOG', () => {
    // `CHECK_CATALOG_METRIC` is an open `Partial<Record<string, MetricKey>>`, so
    // a raw lookup is typed `MetricKey | undefined`. Go through
    // `catalogMetricForCheck`, which reports a missing metric as `null`: a key
    // that is present in the map but unmapped has to fail here, not slip past.
    for (const checkId of Object.keys(CHECK_CATALOG_METRIC)) {
      const metric = catalogMetricForCheck(checkId)
      if (metric === null) {
        throw new Error(`CHECK_CATALOG_METRIC["${checkId}"] has no metric`)
      }
      expect(Object.hasOwn(METRIC_CATALOG, metric)).toBe(true)
    }
  })

  test('unmapped checks return null instead of a fuzzy guess', () => {
    // The catalog's `long-running-queries` counts `elapsed > 300`; the check
    // counts `elapsed > 60 AND is_initial_query`. Mapping them would create a
    // rule that never fires at the check's own threshold.
    expect(catalogMetricForCheck('long-running-queries')).toBeNull()
    // The catalog's `parts-per-partition-max` includes system databases.
    expect(catalogMetricForCheck('max-parts')).toBeNull()
    expect(catalogMetricForCheck('oom-killed')).toBeNull()
  })

  test('every mapped check id is a real health check id', () => {
    const ids = new Set(HEALTH_CHECKS.map((c) => c.id))
    for (const checkId of Object.keys(CHECK_CATALOG_METRIC)) {
      expect(ids.has(checkId)).toBe(true)
    }
  })
})

describe('resolveMetricAlertSignals', () => {
  test('a bare localStorage map is enough to say "configured" (#3437)', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'replication-lag',
      thresholds: { 'replication-lag': { warning: 10, critical: 20 } },
    })
    expect(signals.configured).toBe(true)
    expect(signals.sources).toEqual(['threshold'])
    expect(signals.lastState).toBeNull()
  })

  test('no signals at all is a truthful "not configured"', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'replication-lag',
      thresholds: {},
      customRuleMetrics: [],
      alertStates: [],
    })
    expect(signals.configured).toBe(false)
    expect(signals.sources).toEqual([])
    expect(describeAlertSignals(signals)).toBeNull()
  })

  test('a tuned threshold wins even when a different check is tuned', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'disk-percent',
      thresholds: { 'replication-lag': { warning: 1, critical: 2 } },
    })
    expect(signals.configured).toBe(false)
  })

  test('a custom rule matches only via the explicit catalog mapping', () => {
    const onDisk = resolveMetricAlertSignals({
      checkId: 'disk-percent',
      thresholds: {},
      customRuleMetrics: ['disk-usage-percent'],
    })
    expect(onDisk.sources).toEqual(['rule'])

    // A rule on a *different* metric must not light up this check.
    const other = resolveMetricAlertSignals({
      checkId: 'oom-killed',
      thresholds: {},
      customRuleMetrics: ['disk-usage-percent'],
    })
    expect(other.configured).toBe(false)
  })

  test('alert state keys off the check id, scoped to the host when given', () => {
    const rows = [
      state({ ruleId: 'disk-percent', hostId: 2, severity: 'critical' }),
    ]
    expect(
      resolveMetricAlertSignals({
        checkId: 'disk-percent',
        thresholds: {},
        alertStates: rows,
      }).sources
    ).toEqual(['state'])

    expect(
      resolveMetricAlertSignals({
        checkId: 'disk-percent',
        thresholds: {},
        alertStates: rows,
        hostId: 0,
      }).configured
    ).toBe(false)

    const matched = resolveMetricAlertSignals({
      checkId: 'disk-percent',
      thresholds: {},
      alertStates: rows,
      hostId: 2,
    })
    expect(matched.lastState?.severity).toBe('critical')
  })

  test('a custom rule id never matches the state source (ids ≠ check ids)', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'disk-percent',
      thresholds: {},
      alertStates: [state({ ruleId: 'custom:abc-1234' })],
    })
    expect(signals.sources).toEqual([])
  })

  test('a recovered (`ok`) state row still counts as configured', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'stuck-merges',
      thresholds: {},
      alertStates: [state({ ruleId: 'stuck-merges', severity: 'ok' })],
    })
    expect(signals.configured).toBe(true)
  })

  test('sources are reported cheapest-first and summarised for humans', () => {
    const signals = resolveMetricAlertSignals({
      checkId: 'disk-percent',
      thresholds: { 'disk-percent': { warning: 70, critical: 90 } },
      customRuleMetrics: ['disk-usage-percent'],
      alertStates: [state({ ruleId: 'disk-percent' })],
    })
    expect(signals.sources).toEqual(['threshold', 'rule', 'state'])
    expect(describeAlertSignals(signals)).toBe(
      'tuned thresholds · a named alert rule · recorded alert state'
    )
  })
})
