/**
 * #3798: hosts are evaluated concurrently, but dispatch stays serial and in
 * host order — the dispatcher owns shared dedup/digest state, so its call
 * sequence must not depend on which host's SQL finished first.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { DispatchFindingParams } from './dispatch'
import type { SweepContext } from './resolve-config'
import type { HostSweepResult } from './run-host'

import { HOST_SWEEP_CONCURRENCY, sweepHosts } from '../server-sweep'
import { describe, expect, test } from 'bun:test'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function host(id: number): ClickHouseConfig {
  return {
    id,
    host: `http://h${id}:8123`,
    customName: `h${id}`,
  } as ClickHouseConfig
}

const ctx = {} as SweepContext

function params(hostId: number, ruleId: string): DispatchFindingParams {
  return {
    hostId,
    hostName: `h${hostId}`,
    ruleId,
    ruleTitle: ruleId,
    ruleType: 'threshold',
    severity: 'warning',
    value: 1,
    label: '1',
  }
}

/** A fake host sweep: waits `delayMs[id]`, dispatches two rules, or throws. */
function fakeRunHost(
  delayMs: Record<number, number>,
  throwOn: Set<number> = new Set(),
  inFlight = { now: 0, peak: 0 }
) {
  return async (
    config: ClickHouseConfig,
    _ctx: SweepContext,
    dispatch: (p: DispatchFindingParams) => Promise<void>
  ): Promise<HostSweepResult> => {
    inFlight.now++
    inFlight.peak = Math.max(inFlight.peak, inFlight.now)
    try {
      await sleep(delayMs[config.id] ?? 0)
      if (throwOn.has(config.id)) throw new Error('boom')
      await dispatch(params(config.id, 'a'))
      await dispatch(params(config.id, 'b'))
      return {
        summary: {
          hostId: config.id,
          hostName: `h${config.id}`,
          checksRun: 2,
          findings: 0,
          errored: 0,
          skipped: 0,
        },
        findings: [],
        insightsGenerated: 0,
      }
    } finally {
      inFlight.now--
    }
  }
}

describe('sweepHosts (#3798)', () => {
  test('slow hosts overlap instead of running one after another', async () => {
    const inFlight = { now: 0, peak: 0 }
    await sweepHosts(
      [host(0), host(1), host(2)],
      ctx,
      async () => {},
      fakeRunHost({ 0: 50, 1: 50, 2: 50 }, new Set(), inFlight)
    )
    expect(inFlight.peak).toBe(3)
  })

  test('never runs more than HOST_SWEEP_CONCURRENCY hosts at once', async () => {
    const inFlight = { now: 0, peak: 0 }
    await sweepHosts(
      [0, 1, 2, 3, 4, 5, 6].map(host),
      ctx,
      async () => {},
      fakeRunHost({ 0: 20, 1: 20, 2: 20, 3: 20 }, new Set(), inFlight)
    )
    expect(inFlight.peak).toBeGreaterThan(1)
    expect(inFlight.peak).toBeLessThanOrEqual(HOST_SWEEP_CONCURRENCY)
  })

  test('dispatch order equals host order even when the first host finishes last', async () => {
    const calls: string[] = []
    const results = await sweepHosts(
      [host(0), host(1), host(2)],
      ctx,
      async (p) => {
        calls.push(`${p.hostId}:${p.ruleId}`)
      },
      fakeRunHost({ 0: 120, 1: 10, 2: 60 })
    )
    expect(calls).toEqual(['0:a', '0:b', '1:a', '1:b', '2:a', '2:b'])
    expect(results.map((r) => r.summary.hostId)).toEqual([0, 1, 2])
  })

  test('dispatch is never concurrent', async () => {
    let active = 0
    let peak = 0
    await sweepHosts(
      [host(0), host(1), host(2)],
      ctx,
      async () => {
        active++
        peak = Math.max(peak, active)
        await sleep(5)
        active--
      },
      fakeRunHost({})
    )
    expect(peak).toBe(1)
  })

  test('a throwing host becomes an errored summary and the others still dispatch', async () => {
    const calls: string[] = []
    const results = await sweepHosts(
      [host(0), host(1), host(2)],
      ctx,
      async (p) => {
        calls.push(`${p.hostId}:${p.ruleId}`)
      },
      fakeRunHost({}, new Set([1]))
    )
    expect(calls).toEqual(['0:a', '0:b', '2:a', '2:b'])
    expect(results.map((r) => [r.summary.hostId, r.summary.errored])).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ])
  })

  test('a throwing dispatch counts as an errored check and later calls still run', async () => {
    const calls: string[] = []
    const results = await sweepHosts(
      [host(0), host(1)],
      ctx,
      async (p) => {
        calls.push(`${p.hostId}:${p.ruleId}`)
        if (p.hostId === 0 && p.ruleId === 'a') throw new Error('send failed')
      },
      fakeRunHost({})
    )
    expect(calls).toEqual(['0:a', '0:b', '1:a', '1:b'])
    expect(results[0]?.summary.errored).toBe(1)
    expect(results[1]?.summary.errored).toBe(0)
  })
})
