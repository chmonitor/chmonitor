import { fingerprintLogMessage, groupLogsByPattern } from './log-fingerprint'
import { describe, expect, test } from 'bun:test'

const fp = fingerprintLogMessage

describe('fingerprintLogMessage', () => {
  test('collapses QRep partition lines that differ only in count and table', () => {
    const a = fp('replicated 1 partitions to destination for table orders')
    const b = fp('replicated 12 partitions to destination for table customers')
    expect(a).toBe('replicated <n> partitions to destination for table <name>')
    expect(a).toBe(b)
  })

  test('strips Postgres LSNs', () => {
    expect(fp('slot lag at 0/1A2B3C4D, confirmed 16/B374D848')).toBe(
      'slot lag at <lsn>, confirmed <lsn>'
    )
  })

  test('strips UUIDs', () => {
    expect(fp('workflow 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed')).toBe(
      'workflow <uuid> failed'
    )
  })

  test('strips timestamps as one placeholder, not a run of numbers', () => {
    expect(fp('batch started at 2026-10-11T08:15:30.123Z')).toBe(
      'batch started at <ts>'
    )
    expect(fp('at 2026-10-11 08:15:30+00 retry')).toBe('at <ts> retry')
  })

  test('strips quoted and qualified table names', () => {
    expect(fp('relation "public"."orders" does not exist')).toBe(
      'relation <name> does not exist'
    )
    expect(fp("column 'id' missing in public.orders")).toBe(
      'column <name> missing in <name>'
    )
    expect(fp('sync to analytics.events.raw failed')).toBe(
      'sync to <name> failed'
    )
  })

  test('strips host:port so connection resets group across peers', () => {
    const a = fp('dial tcp 10.0.3.17:5432: connect: connection reset by peer')
    const b = fp(
      'dial tcp pg-replica-2.internal:6543: connect: connection reset by peer'
    )
    expect(a).toBe('dial tcp <host>: connect: connection reset by peer')
    expect(a).toBe(b)
  })

  test('strips plain and hex numbers, keeps the words', () => {
    expect(fp('normalized 4521 records in batch 77 (0xdeadbeef)')).toBe(
      'normalized <n> records in batch <n> (<n>)'
    )
  })

  test('CDC slot error keeps its distinguishing text', () => {
    expect(
      fp('replication slot "peerflow_slot_mirror_a" is active for PID 81234')
    ).toBe('replication slot <name> is active for PID <n>')
  })

  test('handles empty input and collapses whitespace', () => {
    expect(fp(undefined)).toBe('')
    expect(fp('  a   b  ')).toBe('a b')
  })
})

describe('groupLogsByPattern', () => {
  const e = (
    message: string,
    level: 'error' | 'warn' | 'info',
    mirror: string,
    ts: number | null
  ) => ({ message, level, mirror, ts })

  test('groups repeats with count, first/last seen, mirrors, newest sample', () => {
    const groups = groupLogsByPattern([
      e(
        'replicated 1 partitions to destination for table a',
        'info',
        'm1',
        100
      ),
      e(
        'replicated 3 partitions to destination for table b',
        'info',
        'm2',
        300
      ),
      e(
        'replicated 2 partitions to destination for table c',
        'info',
        'm1',
        200
      ),
    ])
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(g.count).toBe(3)
    expect(g.firstSeen).toBe(100)
    expect(g.lastSeen).toBe(300)
    expect(g.mirrors).toEqual(['m2', 'm1'])
    expect(g.sample.message).toContain('table b')
    expect(g.entries.map((x) => x.ts)).toEqual([300, 200, 100])
  })

  test('the same text at different levels stays separate', () => {
    const groups = groupLogsByPattern([
      e('timeout after 5s', 'error', 'm1', 1),
      e('timeout after 9s', 'info', 'm1', 2),
    ])
    expect(groups).toHaveLength(2)
  })

  test('errors sort above newer, larger info groups so they are not buried', () => {
    const groups = groupLogsByPattern([
      e('replicated 1 partitions', 'info', 'm1', 900),
      e('replicated 2 partitions', 'info', 'm2', 950),
      e('slot "s" is active for PID 1', 'error', 'm3', 10),
      e('lag high on 0/AB', 'warn', 'm1', 20),
    ])
    expect(groups.map((g) => g.level)).toEqual(['error', 'warn', 'info'])
  })

  test('missing timestamps give null first/last seen', () => {
    const [g] = groupLogsByPattern([e('x', 'info', 'm', null)])
    expect(g.firstSeen).toBeNull()
    expect(g.lastSeen).toBeNull()
  })
})
