import { jobPartitionAnalytics, partitionState } from './job-analytics'
import { describe, expect, test } from 'bun:test'

describe('partitionState', () => {
  test('queued / running / done / error', () => {
    expect(partitionState({})).toBe('queued')
    expect(partitionState({ startTime: '2026-08-18T00:00:00Z' })).toBe(
      'running'
    )
    expect(
      partitionState({
        startTime: '2026-08-18T00:00:00Z',
        endTime: '2026-08-18T00:00:05Z',
        rowsInPartition: 10,
        rowsSynced: 10,
      })
    ).toBe('done')
    expect(
      partitionState({
        startTime: '2026-08-18T00:00:00Z',
        endTime: '2026-08-18T00:00:05Z',
        rowsInPartition: 10,
        rowsSynced: 4,
      })
    ).toBe('error')
  })
})

describe('jobPartitionAnalytics', () => {
  test('empty partitions', () => {
    expect(jobPartitionAnalytics([])).toEqual({
      total: 0,
      done: 0,
      running: 0,
      queued: 0,
      error: 0,
      rowsIn: 0,
      rowsSynced: 0,
      avgDurationSec: null,
    })
  })

  test('counts done / running / queued / error and averages duration', () => {
    const stats = jobPartitionAnalytics([
      {
        partitionId: 'a',
        startTime: '2026-08-18T08:17:52.000Z',
        endTime: '2026-08-18T08:17:57.000Z',
        rowsInPartition: 515,
        rowsSynced: 515,
      },
      {
        partitionId: 'b',
        startTime: '2026-08-18T08:18:00.000Z',
        rowsInPartition: 800,
        rowsSynced: 240,
      },
      {
        partitionId: 'c',
        rowsInPartition: 100,
        rowsSynced: 0,
      },
      {
        partitionId: 'd',
        startTime: '2026-08-18T08:19:00.000Z',
        endTime: '2026-08-18T08:19:10.000Z',
        rowsInPartition: 100,
        rowsSynced: 40,
      },
    ])
    expect(stats.total).toBe(4)
    expect(stats.done).toBe(1)
    expect(stats.running).toBe(1)
    expect(stats.queued).toBe(1)
    expect(stats.error).toBe(1)
    expect(stats.rowsIn).toBe(1515)
    expect(stats.rowsSynced).toBe(795)
    expect(stats.avgDurationSec).toBe(5)
  })
})
