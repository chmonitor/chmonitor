import type { HealthCheckDef } from '@/components/health/health-checks'
import type { HealthCheckState } from '@/components/health/use-health-checks'
import type { Thresholds } from '@/lib/health/thresholds-storage'

import { describe, expect, test } from 'bun:test'
import {
  computeCheckStatus,
  computeRunningMutations,
  computeStuckMutations,
  SEVERITY_RANK,
} from '@/lib/health/health-status'

const thresholds: Thresholds = { warning: 10, critical: 100 }

const check = {
  id: 'failed-queries',
  title: 'Failed Queries',
  valueKey: 'failed_count',
} as HealthCheckDef

const state = (data: Record<string, unknown>[]): HealthCheckState => ({ data })

describe('computeCheckStatus', () => {
  test('loading state takes precedence', () => {
    const r = computeCheckStatus(
      check,
      thresholds,
      state([{ failed_count: 5 }]),
      true
    )
    expect(r.status).toBe('loading')
    expect(r.value).toBeNull()
    expect(r.displayValue).toBe('—')
  })

  test('result error → error status', () => {
    const r = computeCheckStatus(
      check,
      thresholds,
      { data: [], error: { type: 'query_error', message: 'boom' } },
      false
    )
    expect(r.status).toBe('error')
    expect(r.label).toBe('Unavailable')
  })

  test('missing optional table → error with its status message', () => {
    const r = computeCheckStatus(
      check,
      thresholds,
      { data: [], status: 'table_not_found', statusMessage: 'No query_log' },
      false
    )
    expect(r.status).toBe('error')
    expect(r.label).toBe('No query_log')
  })

  test('threshold boundaries: ok / warning / critical are inclusive', () => {
    expect(
      computeCheckStatus(check, thresholds, state([{ failed_count: 9 }]), false)
        .status
    ).toBe('ok')
    expect(
      computeCheckStatus(
        check,
        thresholds,
        state([{ failed_count: 10 }]),
        false
      ).status
    ).toBe('warning')
    expect(
      computeCheckStatus(
        check,
        thresholds,
        state([{ failed_count: 99 }]),
        false
      ).status
    ).toBe('warning')
    expect(
      computeCheckStatus(
        check,
        thresholds,
        state([{ failed_count: 100 }]),
        false
      ).status
    ).toBe('critical')
  })

  test('empty data is treated as a healthy zero', () => {
    const r = computeCheckStatus(check, thresholds, state([]), false)
    expect(r.status).toBe('ok')
    expect(r.value).toBe(0)
  })

  test('replication check on a host without replication is not applicable, not ok (#4044)', () => {
    const repl = {
      ...check,
      valueKey: 'readonly_count',
      requiresReplication: true,
    } as HealthCheckDef
    const r = computeCheckStatus(
      repl,
      thresholds,
      state([{ readonly_count: 0, replication_used: 0 }]),
      false
    )
    expect(r.status).toBe('error')
    expect(r.label).toBe('Replication not used on this host')
    expect(r.displayValue).toBe('—')
    expect(r.value).toBeNull()
  })

  test('replication check on a host with replication still classifies', () => {
    const repl = {
      ...check,
      valueKey: 'readonly_count',
      requiresReplication: true,
    } as HealthCheckDef
    const r = computeCheckStatus(
      repl,
      thresholds,
      state([{ readonly_count: 0, replication_used: 1 }]),
      false
    )
    expect(r.status).toBe('ok')
  })

  test('non-finite value → error, not a misleading zero', () => {
    const r = computeCheckStatus(
      check,
      thresholds,
      state([{ failed_count: 'nope' }]),
      false
    )
    expect(r.status).toBe('error')
    expect(r.value).toBeNull()
    expect(r.label).toBe('Invalid value')
  })

  test('formatValue/formatLabel drive the display strings', () => {
    const pct = {
      ...check,
      formatValue: (v: number | null) => (v == null ? '—' : `${v}%`),
      formatLabel: (v: number | null) => `${v ?? 0}% used`,
    } as HealthCheckDef
    const r = computeCheckStatus(
      pct,
      { warning: 80, critical: 95 },
      state([{ failed_count: 84.9 }]),
      false
    )
    expect(r.displayValue).toBe('84.9%')
    expect(r.label).toBe('84.9% used')
  })
})

describe('computeStuckMutations', () => {
  test('any stuck or failed mutation is critical', () => {
    expect(
      computeStuckMutations(state([{ active: 0, stuck: 1, failed: 0 }]), false)
        .status
    ).toBe('critical')
    expect(
      computeStuckMutations(state([{ active: 0, stuck: 0, failed: 2 }]), false)
        .status
    ).toBe('critical')
  })

  test('more than five active is a warning, headline tracks stuck', () => {
    const r = computeStuckMutations(
      state([{ active: 6, stuck: 0, failed: 0 }]),
      false
    )
    expect(r.status).toBe('warning')
    expect(r.value).toBe(0)
    expect(r.label).toBe('6 active · 0 stuck · 0 failed')
  })

  test('exactly five active stays ok (boundary)', () => {
    expect(
      computeStuckMutations(state([{ active: 5, stuck: 0, failed: 0 }]), false)
        .status
    ).toBe('ok')
  })

  test('stuck outranks a high active count (worst-of wins)', () => {
    expect(
      computeStuckMutations(state([{ active: 9, stuck: 1, failed: 0 }]), false)
        .status
    ).toBe('critical')
  })

  test('no data → healthy zero', () => {
    expect(computeStuckMutations(state([]), false).status).toBe('ok')
  })
})

describe('computeRunningMutations', () => {
  test('thresholds: <3 ok, ≥3 warning, ≥10 critical', () => {
    expect(
      computeRunningMutations(state([{ running_count: 2 }]), false).status
    ).toBe('ok')
    expect(
      computeRunningMutations(state([{ running_count: 3 }]), false).status
    ).toBe('warning')
    expect(
      computeRunningMutations(state([{ running_count: 10 }]), false).status
    ).toBe('critical')
  })

  test('non-finite running count is reported as error', () => {
    const r = computeRunningMutations(state([{ running_count: 'oops' }]), false)
    expect(r.status).toBe('error')
    expect(r.value).toBe(0)
  })
})

describe('SEVERITY_RANK', () => {
  test('orders worst first, unknown states last', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.ok)
    expect(SEVERITY_RANK.ok).toBeLessThan(SEVERITY_RANK.error)
    expect(SEVERITY_RANK.error).toBeLessThan(SEVERITY_RANK.loading)
  })
})
