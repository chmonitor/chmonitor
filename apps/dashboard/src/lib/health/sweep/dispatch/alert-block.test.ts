/**
 * The `alert` block (#3998) is what an agent reads. What must hold:
 * cluster-originated strings only appear under `untrusted`, redacted and
 * truncated; `firstSeenAt` is the alert-history sighting, not the
 * post-hysteresis open time; and nothing is read unless a destination asks.
 */

import type { AlertBlockParams } from './alert-block'

import {
  buildAlertBlock,
  createAlertBlockResolver,
  sanitizeUntrusted,
  UNTRUSTED_STRING_MAX,
} from './alert-block'
import { describe, expect, test } from 'bun:test'

const now = '2026-01-02T00:00:00.000Z'

const base: AlertBlockParams = {
  ruleId: 'disk-usage',
  kind: 'reminder',
  severity: 'warning',
  value: 82.9,
  previousValue: 82.8,
  previousState: {
    severity: 'warning',
    updatedAt: 0,
    notifiedAt: 0,
    // Post-hysteresis open time: must NOT surface as firstSeenAt.
    firstFiredAt: Date.parse('2026-01-01T12:00:00.000Z'),
    repeatCount: 4,
  },
  warnThreshold: 80,
  critThreshold: 90,
  affected: [],
  firstSeenAt: '2026-01-01T10:00:00.000Z',
  now,
}

describe('buildAlertBlock', () => {
  test('carries the agreed schema and only generated values at top level', () => {
    const block = buildAlertBlock(base)
    expect(block).toEqual({
      ruleId: 'disk-usage',
      metric: 'disk-usage',
      threshold: 80,
      value: 82.9,
      previousValue: 82.8,
      trend: 'rising',
      firstSeenAt: '2026-01-01T10:00:00.000Z',
      repeatCount: 4,
      untrusted: { affected: [] },
    })
  })

  test('threshold follows the severity; trend needs a baseline', () => {
    const crit = buildAlertBlock({
      ...base,
      severity: 'critical',
      previousValue: undefined,
    })
    expect(crit.threshold).toBe(90)
    expect(crit.trend).toBeNull()
    expect(crit.previousValue).toBeNull()
  })

  test('firstSeenAt: history first, a new episode starts now, else null', () => {
    expect(
      buildAlertBlock({ ...base, kind: 'new', firstSeenAt: null }).firstSeenAt
    ).toBe(now)
    expect(buildAlertBlock({ ...base, firstSeenAt: null }).firstSeenAt).toBe(
      null
    )
  })

  test('affected names and contributor strings are redacted and truncated', () => {
    const secretName =
      "s3('https://b.example/x', 'AKIAEXAMPLEKEY', 'topsecretvalue')"
    const block = buildAlertBlock({
      ...base,
      affected: [secretName, 'ops@example.com', 'x'.repeat(5000)],
      topContributors: [
        {
          kind: 'query',
          queryId: 'q1',
          user: 'alice@example.com',
          elapsedSeconds: 1,
          memoryBytes: 2,
          normalizedQuery: "SELECT 1 FROM remote(?, db, t, 'u', 'pw-secret')",
        },
      ],
    })
    const json = JSON.stringify(block)
    for (const leaked of [
      'topsecretvalue',
      'AKIAEXAMPLEKEY',
      'ops@example.com',
      'alice@example.com',
      'pw-secret',
    ]) {
      expect(json).not.toContain(leaked)
    }
    for (const s of block.untrusted.affected) {
      expect(s.length).toBeLessThanOrEqual(UNTRUSTED_STRING_MAX)
    }
    expect(block.untrusted.topContributors).toHaveLength(1)
  })

  test('sanitizeUntrusted keeps a short clean name unchanged', () => {
    expect(sanitizeUntrusted('db.events')).toBe('db.events')
  })
})

describe('createAlertBlockResolver', () => {
  const params = {
    ...base,
    hostId: 3,
  }

  test('reads nothing until asked, then once for every caller', async () => {
    let firstSeenCalls = 0
    let contributorCalls = 0
    const resolve = createAlertBlockResolver(params, {
      firstSeen: async () => {
        firstSeenCalls++
        return '2026-01-01T09:00:00.000Z'
      },
      contributors: async () => {
        contributorCalls++
        return [{ kind: 'table', database: 'db', table: 't', bytesOnDisk: 1 }]
      },
    })
    expect(firstSeenCalls + contributorCalls).toBe(0)
    const [a, b] = await Promise.all([resolve(), resolve()])
    expect(a).toBe(b)
    expect(firstSeenCalls).toBe(1)
    expect(contributorCalls).toBe(1)
    expect(a.firstSeenAt).toBe('2026-01-01T09:00:00.000Z')
    expect(a.untrusted.topContributors).toHaveLength(1)
  })

  test('a recovery reads no contributors; failed reads degrade to unknown', async () => {
    let contributorCalls = 0
    const block = await createAlertBlockResolver(
      { ...params, kind: 'recovery' },
      {
        firstSeen: async () => {
          throw new Error('d1 down')
        },
        contributors: async () => {
          contributorCalls++
          return undefined
        },
      }
    )()
    expect(contributorCalls).toBe(0)
    expect(block.firstSeenAt).toBeNull()
    expect('topContributors' in block.untrusted).toBe(false)
  })
})
