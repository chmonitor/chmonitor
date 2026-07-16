/**
 * Tests for the PURE alert-suggestion scorer (issue #2667).
 *
 * These lock the intent of each heuristic — WHY a suggestion fires — not just
 * that some suggestion appears: near-threshold needs a value ≥70% of the
 * default; a baseline yields p95/p99-shaped thresholds; cluster-shape fires only
 * on a replicated/multi-disk cluster; a recurring finding is codified; an
 * already-covered metric is never re-suggested; and same-metric collisions
 * resolve by source priority. No I/O — the scorer is a pure function.
 */

import type { HostSignals } from './alert-suggestions'

import {
  buildSuggestions,
  METRIC_SUGGESTION_DEFAULTS,
  NEAR_THRESHOLD_FRACTION,
} from './alert-suggestions'
import { compileCustomRule } from './rule-builder-schema'
import { describe, expect, test } from 'bun:test'

function host(over: Partial<HostSignals> = {}): HostSignals {
  return {
    hostId: 0,
    hostName: 'ch-0',
    existingRuleMetrics: new Set(),
    clusterShape: null,
    metricValues: {},
    baselines: {},
    recurringFindings: {},
    ...over,
  }
}

describe('buildSuggestions — near-threshold', () => {
  test('fires when a metric sits at ≥70% of its default warning', () => {
    const warn = METRIC_SUGGESTION_DEFAULTS['disk-usage-percent'].warning
    const suggestions = buildSuggestions([
      host({
        metricValues: { 'disk-usage-percent': warn * NEAR_THRESHOLD_FRACTION },
      }),
    ])
    const s = suggestions.find((x) => x.metric === 'disk-usage-percent')
    expect(s).toBeDefined()
    expect(s?.source).toBe('near-threshold')
    expect(s?.warning).toBe(warn)
    expect(s?.key).toBe('disk-usage-percent:host:0')
  })

  test('does NOT fire below 70% of the default warning', () => {
    const warn = METRIC_SUGGESTION_DEFAULTS['disk-usage-percent'].warning
    const suggestions = buildSuggestions([
      host({ metricValues: { 'disk-usage-percent': warn * 0.5 } }),
    ])
    expect(
      suggestions.find((x) => x.metric === 'disk-usage-percent')
    ).toBeUndefined()
  })

  test('does NOT fire on a zero value (idle metric)', () => {
    const suggestions = buildSuggestions([
      host({ metricValues: { 'stuck-merges': 0 } }),
    ])
    expect(suggestions.find((x) => x.metric === 'stuck-merges')).toBeUndefined()
  })
})

describe('buildSuggestions — baseline', () => {
  test('yields warning≈mean+2σ (p95) and critical≈mean+3σ (p99)', () => {
    const suggestions = buildSuggestions([
      host({
        baselines: {
          'running-queries': { mean: 300, stddev: 50, sampleCount: 200 },
        },
      }),
    ])
    const s = suggestions.find((x) => x.metric === 'running-queries')
    expect(s?.source).toBe('baseline')
    expect(s?.warning).toBe(400) // 300 + 2*50
    expect(s?.critical).toBe(450) // 300 + 3*50
  })

  test('is ignored when the baseline is too thin (few samples)', () => {
    const suggestions = buildSuggestions([
      host({
        baselines: {
          'running-queries': { mean: 300, stddev: 50, sampleCount: 5 },
        },
      }),
    ])
    expect(
      suggestions.find((x) => x.metric === 'running-queries')
    ).toBeUndefined()
  })

  test('never proposes a warning below the metric default (quiet baseline)', () => {
    // mean ~0 baseline would otherwise suggest firing on the first blip.
    const suggestions = buildSuggestions([
      host({
        baselines: {
          'failed-mutations': { mean: 0, stddev: 0.1, sampleCount: 200 },
        },
      }),
    ])
    const s = suggestions.find((x) => x.metric === 'failed-mutations')
    expect(s?.warning).toBeGreaterThanOrEqual(
      METRIC_SUGGESTION_DEFAULTS['failed-mutations'].warning
    )
  })
})

describe('buildSuggestions — cluster-shape', () => {
  test('suggests replication alerts on a replicated cluster', () => {
    const suggestions = buildSuggestions([
      host({ clusterShape: { replicatedTables: 12, disks: 1 } }),
    ])
    const metrics = suggestions.map((s) => s.metric)
    expect(metrics).toContain('replication-max-lag')
    expect(metrics).toContain('readonly-replicas')
    expect(metrics).toContain('replication-queue-max')
    expect(
      suggestions.find((s) => s.metric === 'replication-max-lag')?.source
    ).toBe('cluster-shape')
  })

  test('does NOT suggest replication alerts on a non-replicated cluster', () => {
    const suggestions = buildSuggestions([
      host({ clusterShape: { replicatedTables: 0, disks: 1 } }),
    ])
    expect(
      suggestions.find((s) => s.metric === 'replication-max-lag')
    ).toBeUndefined()
  })

  test('suggests disk-usage on a multi-disk (tiered) cluster', () => {
    const suggestions = buildSuggestions([
      host({ clusterShape: { replicatedTables: 0, disks: 3 } }),
    ])
    expect(
      suggestions.find((s) => s.metric === 'disk-usage-percent')?.source
    ).toBe('cluster-shape')
  })
})

describe('buildSuggestions — recurring findings', () => {
  test('codifies a finding that recurred ≥2 times', () => {
    const suggestions = buildSuggestions([
      host({
        recurringFindings: {
          'stuck-merges': { count: 4, lastTitle: 'Merges piling up' },
        },
      }),
    ])
    const s = suggestions.find((x) => x.metric === 'stuck-merges')
    expect(s?.source).toBe('recurring-finding')
    expect(s?.reason).toContain('Merges piling up')
  })
})

describe('buildSuggestions — dedup & exclusion', () => {
  test('never re-suggests a metric that already has a rule', () => {
    const suggestions = buildSuggestions([
      host({
        existingRuleMetrics: new Set(['disk-usage-percent']),
        metricValues: { 'disk-usage-percent': 99 },
        clusterShape: { replicatedTables: 0, disks: 5 },
      }),
    ])
    expect(
      suggestions.find((s) => s.metric === 'disk-usage-percent')
    ).toBeUndefined()
  })

  test('one suggestion per metric — highest-priority source wins', () => {
    // disk-usage fires from BOTH near-threshold and cluster-shape; recurring
    // outranks both.
    const suggestions = buildSuggestions([
      host({
        metricValues: { 'disk-usage-percent': 99 },
        clusterShape: { replicatedTables: 0, disks: 5 },
        recurringFindings: {
          'disk-usage-percent': { count: 3, lastTitle: 'Disk filling' },
        },
      }),
    ])
    const disk = suggestions.filter((s) => s.metric === 'disk-usage-percent')
    expect(disk).toHaveLength(1)
    expect(disk[0].source).toBe('recurring-finding')
  })

  test('scopes keys per host', () => {
    const suggestions = buildSuggestions([
      host({ hostId: 0, metricValues: { 'stuck-merges': 2 } }),
      host({
        hostId: 1,
        hostName: 'ch-1',
        metricValues: { 'stuck-merges': 2 },
      }),
    ])
    const keys = suggestions
      .filter((s) => s.metric === 'stuck-merges')
      .map((s) => s.key)
      .sort()
    expect(keys).toEqual(['stuck-merges:host:0', 'stuck-merges:host:1'])
  })
})

describe('buildSuggestions — invariants', () => {
  test('every suggestion targets a catalog metric with sane thresholds', () => {
    const suggestions = buildSuggestions([
      host({
        clusterShape: { replicatedTables: 5, disks: 3 },
        metricValues: { 'stuck-merges': 5, 'failed-mutations': 2 },
      }),
    ])
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      expect(s.op).toBe('>=')
      // higher-is-worse: critical must be ≥ warning
      expect(s.critical).toBeGreaterThanOrEqual(s.warning)
      expect(s.reason.length).toBeGreaterThan(0)
    }
  })

  test('accepting any suggestion compiles into a working custom rule', () => {
    // The accept path feeds (name/metric/op/warning/critical) straight into
    // createCustomRule → compileCustomRule. Every suggestion must survive that.
    const suggestions = buildSuggestions([
      host({
        clusterShape: { replicatedTables: 5, disks: 3 },
        metricValues: { 'stuck-merges': 5 },
        baselines: {
          'running-queries': { mean: 300, stddev: 50, sampleCount: 200 },
        },
        recurringFindings: {
          'failed-mutations': { count: 3, lastTitle: 'Mutations failing' },
        },
      }),
    ])
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      const rule = compileCustomRule({
        name: s.title,
        metric: s.metric,
        op: s.op,
        warning: s.warning,
        critical: s.critical,
      })
      expect(rule.sql).toBeTruthy()
      expect(rule.type).toBe('custom')
      expect(rule.defaults).toEqual({
        warning: s.warning,
        critical: s.critical,
      })
    }
  })
})
