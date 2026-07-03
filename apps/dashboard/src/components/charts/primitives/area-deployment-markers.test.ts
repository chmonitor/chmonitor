/**
 * Tests for `findNearestBucketKey` (area.tsx) — the pure function that maps a
 * deployment's `createdAt` timestamp onto the nearest bucket on an area
 * chart's category `index` axis, so `<ReferenceLine x={bucketKey}>` matches
 * an actual data point (plans/45-github-deploy-correlation.md). This is the
 * one piece of the deploy-marker overlay not otherwise covered by a live
 * render — get the bucket match wrong and the marker either doesn't render
 * (recharts silently no-ops a category ReferenceLine whose `x` doesn't match
 * any tick) or lands on the wrong day.
 */

import { findNearestBucketKey } from './area'
import { describe, expect, test } from 'bun:test'

const DAILY_BUCKETS = [
  { event_time: '2026-06-28 00:00:00', query_count: 10 },
  { event_time: '2026-06-29 00:00:00', query_count: 20 },
  { event_time: '2026-06-30 00:00:00', query_count: 30 },
  { event_time: '2026-07-01 00:00:00', query_count: 40 },
]

function toMs(s: string): number {
  return new Date(s).getTime()
}

describe('findNearestBucketKey', () => {
  test('an exact match returns that bucket', () => {
    const key = findNearestBucketKey(
      DAILY_BUCKETS,
      'event_time',
      toMs('2026-06-30 00:00:00')
    )
    expect(key).toBe('2026-06-30 00:00:00')
  })

  test('a timestamp between two buckets snaps to the closer one', () => {
    // 06-29 18:00 is 18h after 06-29's bucket, 6h before 06-30's — closer to 06-30.
    const key = findNearestBucketKey(
      DAILY_BUCKETS,
      'event_time',
      toMs('2026-06-29 18:00:00')
    )
    expect(key).toBe('2026-06-30 00:00:00')

    // 06-29 06:00 is 6h after 06-29's bucket, 18h before 06-30's — closer to 06-29.
    const key2 = findNearestBucketKey(
      DAILY_BUCKETS,
      'event_time',
      toMs('2026-06-29 06:00:00')
    )
    expect(key2).toBe('2026-06-29 00:00:00')
  })

  test('a timestamp before the first bucket snaps to the first bucket', () => {
    const key = findNearestBucketKey(
      DAILY_BUCKETS,
      'event_time',
      toMs('2026-06-01 00:00:00')
    )
    expect(key).toBe('2026-06-28 00:00:00')
  })

  test('a timestamp after the last bucket snaps to the last bucket', () => {
    const key = findNearestBucketKey(
      DAILY_BUCKETS,
      'event_time',
      toMs('2026-08-01 00:00:00')
    )
    expect(key).toBe('2026-07-01 00:00:00')
  })

  test('empty data returns undefined', () => {
    const key = findNearestBucketKey(
      [],
      'event_time',
      toMs('2026-06-30 00:00:00')
    )
    expect(key).toBeUndefined()
  })

  test('rows with unparseable/missing index values are skipped, not matched', () => {
    const key = findNearestBucketKey(
      [
        { event_time: null, query_count: 5 },
        { event_time: 'not-a-date', query_count: 5 },
        { event_time: '2026-06-30 00:00:00', query_count: 30 },
      ],
      'event_time',
      toMs('2026-06-30 00:00:00')
    )
    expect(key).toBe('2026-06-30 00:00:00')
  })
})
