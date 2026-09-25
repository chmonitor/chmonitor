import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
  normalizeLogLevel,
  normalizeMirrorLog,
  toMirrorLogsLevelParam,
} from './mirror-logs'
import { describe, expect, test } from 'bun:test'

describe('toMirrorLogsLevelParam', () => {
  test('maps UI levels to the uppercase values strict PeerDB requires', () => {
    expect(toMirrorLogsLevelParam('error')).toBe('ERROR')
    expect(toMirrorLogsLevelParam('warn')).toBe('WARN')
    expect(toMirrorLogsLevelParam('info')).toBe('INFO')
  })

  test('omits the param for all / missing / unknown levels', () => {
    expect(toMirrorLogsLevelParam('all')).toBeUndefined()
    expect(toMirrorLogsLevelParam(undefined)).toBeUndefined()
    expect(toMirrorLogsLevelParam('errorr')).toBeUndefined()
    expect(toMirrorLogsLevelParam('')).toBeUndefined()
  })
})

describe('mirrorLogsRequestBody', () => {
  test('sends uppercase ERROR for the detail-page error query', () => {
    expect(
      mirrorLogsRequestBody('legacy_archive', 'error', { numPerPage: 20 })
    ).toEqual({
      flowJobName: 'legacy_archive',
      level: 'ERROR',
      page: 0,
      numPerPage: 20,
    })
  })

  test('omits level for the unfiltered fleet/panel query', () => {
    const body = mirrorLogsRequestBody('orders_cdc', 'all')
    expect(body).toEqual({
      flowJobName: 'orders_cdc',
      page: 0,
      numPerPage: 100,
    })
    expect('level' in body).toBe(false)
  })
})

describe('normalizeLogLevel', () => {
  test('classifies both cases plus the warning synonym', () => {
    for (const v of ['ERROR', 'error', 'Error', 'ERR']) {
      expect(normalizeLogLevel(v)).toBe('error')
    }
    for (const v of ['WARN', 'warn', 'WARNING', 'warning']) {
      expect(normalizeLogLevel(v)).toBe('warn')
    }
    for (const v of ['INFO', 'info']) {
      expect(normalizeLogLevel(v)).toBe('info')
    }
  })

  test('missing/unknown values are info, never error', () => {
    for (const v of [undefined, null, '', 'DEBUG', 42]) {
      expect(normalizeLogLevel(v)).toBe('info')
    }
  })
})

describe('normalizeMirrorLog', () => {
  test('passes camelCase entries through', () => {
    expect(
      normalizeMirrorLog({
        id: 702169,
        flowName: 'mirror_development',
        errorMessage: 'failed to push data',
        errorType: 'ERROR',
        errorTimestamp: 1748972135285,
      })
    ).toEqual({
      id: 702169,
      flowName: 'mirror_development',
      errorMessage: 'failed to push data',
      errorType: 'ERROR',
      errorTimestamp: 1748972135285,
    })
  })

  test('accepts snake_case and alias spellings', () => {
    expect(
      normalizeMirrorLog({
        id: 7,
        flow_name: 'orders_cdc',
        error_message: 'slot lag',
        error_type: 'warn',
        error_timestamp: '2026-01-01T00:00:00.000Z',
      })
    ).toEqual({
      id: 7,
      flowName: 'orders_cdc',
      errorMessage: 'slot lag',
      errorType: 'warn',
      errorTimestamp: '2026-01-01T00:00:00.000Z',
    })
  })

  test('empty input normalizes to an untyped entry', () => {
    const log = normalizeMirrorLog({})
    expect(log.errorType).toBeUndefined()
    expect(normalizeLogLevel(log.errorType)).toBe('info')
  })
})

describe('extractMirrorLogs', () => {
  const entry = {
    flowName: 'm',
    errorMessage: 'x',
    errorType: 'ERROR',
    errorTimestamp: 1,
  }

  test('unwraps errors / logs / data envelopes and bare arrays', () => {
    expect(extractMirrorLogs({ errors: [entry], total: 1 })).toEqual([entry])
    expect(extractMirrorLogs({ logs: [entry] })).toEqual([entry])
    expect(extractMirrorLogs({ data: [entry] })).toEqual([entry])
    expect(extractMirrorLogs([entry])).toEqual([entry])
  })

  test('normalizes snake_case entries inside any envelope', () => {
    const raw = {
      logs: [
        {
          flow_name: 'm',
          error_message: 'x',
          error_type: 'ERROR',
          error_timestamp: 1,
        },
      ],
    }
    expect(extractMirrorLogs(raw)).toEqual([entry])
  })

  test('garbage payloads yield no logs', () => {
    for (const p of [null, undefined, {}, { errors: null }, 'nope', 42]) {
      expect(extractMirrorLogs(p)).toEqual([])
    }
  })
})

describe('countMirrorLogLevels', () => {
  test('counts per level with case-insensitive classification', () => {
    const counts = countMirrorLogLevels(
      extractMirrorLogs({
        errors: [
          { errorType: 'ERROR' },
          { errorType: 'error' },
          { errorType: 'WARN' },
          { errorType: 'info' },
        ],
      })
    )
    expect(counts).toEqual({ all: 4, error: 2, warn: 1, info: 1 })
  })

  test('untyped and info entries never count as errors', () => {
    const counts = countMirrorLogLevels(
      extractMirrorLogs({ errors: [{}, { errorMessage: 'heartbeat' }] })
    )
    expect(counts).toEqual({ all: 2, error: 0, warn: 0, info: 2 })
  })

  test('detail and fleet consumers agree on the same payload', () => {
    const payload = {
      errors: [
        { errorType: 'ERROR', errorMessage: 'slot approaching max_wal_size' },
        { errorType: 'ERROR', errorMessage: 'too many parts' },
        { errorType: 'WARN', errorMessage: 'throughput dropped' },
        { errorType: 'INFO', errorMessage: 'sync flow committed 100 rows' },
      ],
    }
    // Detail page: server-filtered error query, normalized at the edge.
    const detailErrors = extractMirrorLogs(payload).filter(
      (l) => normalizeLogLevel(l.errorType) === 'error'
    )
    // Fleet feed: unfiltered query, counted by tab.
    const fleetCounts = countMirrorLogLevels(extractMirrorLogs(payload))
    expect(detailErrors.length).toBe(2)
    expect(fleetCounts.error).toBe(detailErrors.length)
  })
})

describe('strict-upstream regression (issue #3406)', () => {
  // Mirrors scripts/peerdb-mock-server.ts: case-sensitive `level` match
  // against uppercase fixtures, like production PeerDB.
  const strictFilter = (entries: { errorType: string }[], level: string) =>
    level && level !== 'ALL'
      ? entries.filter((e) => (e.errorType ?? 'INFO') === level)
      : entries
  const fixture = [{ errorType: 'ERROR' }, { errorType: 'ERROR' }]

  test('lowercase level matches nothing (the always-0 bug)', () => {
    expect(strictFilter(fixture, 'error')).toEqual([])
  })

  test('the fixed request body retrieves the errors', () => {
    const body = mirrorLogsRequestBody('legacy_archive', 'error', {
      numPerPage: 20,
    })
    expect(strictFilter(fixture, String(body.level))).toHaveLength(2)
  })
})
