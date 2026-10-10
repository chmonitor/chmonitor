import {
  decidePeerDBLogPatternAlert,
  formatPeerDBLogPatternLabel,
  groupPeerDBErrorPatterns,
  hashLogFingerprint,
  PEERDB_LOG_PATTERN_MAX_MIRRORS_LISTED,
  PEERDB_LOG_PATTERN_SPIKE_COUNT,
  peerDBLogPatternRuleId,
} from './log-pattern-alerts'
import { describe, expect, test } from 'bun:test'

const firing = { severity: 'warning' as const, updatedAt: 1, notifiedAt: 1 }

describe('groupPeerDBErrorPatterns', () => {
  test('40 mirrors hitting one root cause collapse to one pattern', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({
      flowName: `mirror_${i}`,
      message: `connection to 10.0.0.${i}:5432 refused after ${i + 1} retries`,
    }))
    const patterns = groupPeerDBErrorPatterns(entries)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.count).toBe(40)
    expect(patterns[0]!.mirrors).toHaveLength(40)
  })

  test('distinct patterns get distinct, stable rule ids', () => {
    const patterns = groupPeerDBErrorPatterns([
      { flowName: 'a', message: 'slot "s1" does not exist' },
      { flowName: 'b', message: 'permission denied for table orders' },
    ])
    expect(patterns).toHaveLength(2)
    expect(patterns[0]!.ruleId).not.toBe(patterns[1]!.ruleId)
    for (const p of patterns) {
      expect(p.ruleId).toBe(peerDBLogPatternRuleId(p.fingerprint))
      expect(p.ruleId).toMatch(/^peerdb-log-pattern:[0-9a-f]{8}$/)
    }
    expect(hashLogFingerprint('x')).toBe(hashLogFingerprint('x'))
  })

  test('messages that fingerprint to empty are dropped', () => {
    expect(
      groupPeerDBErrorPatterns([{ flowName: 'a', message: '  ' }])
    ).toEqual([])
  })

  test('label lists affected mirrors and the count, collapsing the tail', () => {
    const n = PEERDB_LOG_PATTERN_MAX_MIRRORS_LISTED + 3
    const [p] = groupPeerDBErrorPatterns(
      Array.from({ length: n }, (_, i) => ({
        flowName: `m${String(i).padStart(2, '0')}`,
        message: 'boom',
      }))
    )
    const label = formatPeerDBLogPatternLabel(p!)
    expect(label).toContain(`${n} errors across ${n} mirrors`)
    expect(label).toContain('m00')
    expect(label).toContain('+3 more')
  })
})

describe('decidePeerDBLogPatternAlert', () => {
  test('unseen pattern is new; a firing one below the spike stays quiet', () => {
    expect(decidePeerDBLogPatternAlert({ count: 1 }, undefined)).toBe('new')
    expect(decidePeerDBLogPatternAlert({ count: 1 }, firing)).toBeNull()
  })

  test('spike boundary: threshold - 1 is not a spike, threshold is', () => {
    const t = PEERDB_LOG_PATTERN_SPIKE_COUNT
    expect(decidePeerDBLogPatternAlert({ count: t - 1 }, firing)).toBeNull()
    expect(decidePeerDBLogPatternAlert({ count: t }, firing)).toBe('spike')
    expect(decidePeerDBLogPatternAlert({ count: t }, undefined)).toBe('spike')
  })
})
