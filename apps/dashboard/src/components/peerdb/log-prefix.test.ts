import { mirrorPrefixResolver } from './log-prefix'
import { describe, expect, test } from 'bun:test'
import { groupLogs } from '@/lib/peerdb/log-groups'

const entry = (mirror: string, message = 'x') => ({
  message,
  level: 'info' as const,
  mirror,
  ts: 1,
})

describe('mirrorPrefixResolver', () => {
  const resolve = mirrorPrefixResolver([
    'qrep_sg_fleetreporting1_202608',
    'qrep_sg_fleetreporting1_202609',
    'cdc_orders',
  ])
  test('uses the same wildcard as the /peerdb prefix groups', () => {
    expect(resolve('qrep_sg_fleetreporting1_202608')).toBe(
      'qrep_sg_fleetreporting1_*'
    )
    expect(resolve('qrep_sg_fleetreporting1_202609')).toBe(
      'qrep_sg_fleetreporting1_*'
    )
  })
  test('ungrouped and unknown mirrors keep their own name', () => {
    expect(resolve('cdc_orders')).toBe('cdc_orders')
    expect(resolve('other')).toBe('other')
  })
})

describe('groupLogs by prefix', () => {
  const rows = [
    entry('qrep_sg_fleetreporting1_202608'),
    entry('qrep_sg_fleetreporting1_202609'),
    entry('cdc_orders'),
  ]
  test('merges sibling mirrors into one group', () => {
    const g = groupLogs(
      rows,
      'prefix',
      mirrorPrefixResolver(rows.map((r) => r.mirror))
    )
    const grp = g.find((x) => x.fingerprint === 'qrep_sg_fleetreporting1_*')
    expect(grp?.count).toBe(2)
    expect(grp?.mirrors).toHaveLength(2)
    expect(g.find((x) => x.fingerprint === 'cdc_orders')?.count).toBe(1)
  })
  test('without a resolver it degrades to per-mirror rows', () => {
    expect(groupLogs(rows, 'prefix')).toHaveLength(3)
  })
})
