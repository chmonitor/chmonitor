import {
  groupBySmartPrefix,
  isVolatileToken,
  splitName,
  wildcardFor,
} from './group-by-prefix'
import { describe, expect, test } from 'bun:test'

describe('splitName', () => {
  test('splits on underscore, hyphen, dot, slash', () => {
    expect(splitName('qrep_sg_fleetreporting1_202608')).toEqual({
      tokens: ['qrep', 'sg', 'fleetreporting1', '202608'],
      seps: ['_', '_', '_'],
    })
    expect(splitName('cdc-prod.orders/v2')).toEqual({
      tokens: ['cdc', 'prod', 'orders', 'v2'],
      seps: ['-', '.', '/'],
    })
  })

  test('a name with no separators is a single token', () => {
    expect(splitName('orders')).toEqual({ tokens: ['orders'], seps: [] })
  })
})

describe('isVolatileToken', () => {
  test('dates, versions, hashes, long ids', () => {
    expect(isVolatileToken('202608')).toBe(true)
    expect(isVolatileToken('20260819')).toBe(true)
    expect(isVolatileToken('2026-08')).toBe(true)
    expect(isVolatileToken('2026-08-19')).toBe(true)
    expect(isVolatileToken('v2')).toBe(true)
    expect(isVolatileToken('v1.4.2')).toBe(true)
    expect(isVolatileToken('deadbeef')).toBe(true)
    expect(isVolatileToken('10001')).toBe(true)
  })

  test('stable job tokens stay as names, not suffixes', () => {
    expect(isVolatileToken('fleetreporting1')).toBe(false)
    expect(isVolatileToken('orders')).toBe(false)
    expect(isVolatileToken('cdc')).toBe(false)
    expect(isVolatileToken('sg')).toBe(false)
  })
})

describe('wildcardFor', () => {
  test('uses the original separator before the collapsed suffix', () => {
    const split = splitName('qrep_sg_fleetreporting1_202608')
    expect(wildcardFor(split, 3)).toBe('qrep_sg_fleetreporting1_*')
    expect(wildcardFor(splitName('job-202608'), 1)).toBe('job-*')
  })
})

describe('groupBySmartPrefix', () => {
  const names = (list: string[]) =>
    groupBySmartPrefix(
      list.map((name) => ({ name })),
      (m) => m.name
    )

  test('date-suffixed QRep jobs group at the longest shared prefix', () => {
    const result = names([
      'qrep_sg_fleetreporting1_202606',
      'qrep_sg_fleetreporting1_202607',
      'qrep_sg_fleetreporting1_202608',
      'qrep_sg_orders_202607',
      'qrep_sg_orders_202608',
      'orders_cdc',
    ])
    expect(result.groups.map((g) => g.wildcard)).toEqual([
      'qrep_sg_fleetreporting1_*',
      'qrep_sg_orders_*',
    ])
    expect(result.groups[0].items.map((m) => m.name)).toEqual([
      'qrep_sg_fleetreporting1_202606',
      'qrep_sg_fleetreporting1_202607',
      'qrep_sg_fleetreporting1_202608',
    ])
    expect(result.ungrouped.map((m) => m.name)).toEqual(['orders_cdc'])
  })

  test('does not collapse distinct families into a coarse qrep_* bucket', () => {
    const result = names([
      'qrep_sg_fleetreporting1_202608',
      'qrep_sg_fleetreporting1_202609',
      'qrep_sg_orders_202608',
      'qrep_sg_orders_202609',
    ])
    expect(result.groups.map((g) => g.wildcard)).toEqual([
      'qrep_sg_fleetreporting1_*',
      'qrep_sg_orders_*',
    ])
    expect(result.ungrouped).toEqual([])
  })

  test('a single job stays ungrouped', () => {
    const result = names(['qrep_sg_fleetreporting1_202608', 'orders_cdc'])
    expect(result.groups).toEqual([])
    expect(result.ungrouped.map((m) => m.name)).toEqual([
      'qrep_sg_fleetreporting1_202608',
      'orders_cdc',
    ])
  })

  test('empty input', () => {
    expect(names([])).toEqual({ groups: [], ungrouped: [] })
  })

  test('names without separators stay ungrouped', () => {
    const result = names(['orders', 'users', 'payments'])
    expect(result.groups).toEqual([])
    expect(result.ungrouped).toHaveLength(3)
  })

  test('version suffixes group (v1 / v2)', () => {
    const result = names(['catalog_sync_v1', 'catalog_sync_v2'])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].wildcard).toBe('catalog_sync_*')
  })

  test('depth-1 groups only when the next token is volatile', () => {
    const volatile = names(['job_202608', 'job_202609', 'job_202610'])
    expect(volatile.groups.map((g) => g.wildcard)).toEqual(['job_*'])

    const stable = names(['job_orders', 'job_users', 'job_payments'])
    expect(stable.groups).toEqual([])
    expect(stable.ungrouped).toHaveLength(3)
  })

  test('respects minGroupSize', () => {
    const result = groupBySmartPrefix(
      [
        { name: 'qrep_sg_orders_202607' },
        { name: 'qrep_sg_orders_202608' },
        { name: 'qrep_sg_orders_202609' },
      ],
      (m) => m.name,
      { minGroupSize: 4 }
    )
    expect(result.groups).toEqual([])
    expect(result.ungrouped).toHaveLength(3)
  })

  test('hyphenated date suffixes keep the hyphen in the wildcard', () => {
    const result = names(['mirror-prod-202608', 'mirror-prod-202609'])
    expect(result.groups.map((g) => g.wildcard)).toEqual(['mirror-prod-*'])
  })
})
