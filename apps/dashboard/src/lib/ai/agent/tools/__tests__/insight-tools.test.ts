import './shared-mocks'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// baseline-store pulls in @chm/platform (Workers-only shim); replace it. The
// real scoreAnomaly is used so the z-score math under test is the real one.
const mockGetBaseline = mock(
  async (_hostId: string, _metric: string) => null
) as any
const mockUpsertBaseline = mock(async (_b: unknown) => {}) as any
mock.module('@/lib/insights/baseline-store', () => ({
  getBaseline: mockGetBaseline,
  upsertBaseline: mockUpsertBaseline,
  listBaselines: async () => [],
}))

const { createInsightTools } = await import('../insight-tools')

const FITTED_AT = Date.UTC(2026, 9, 1, 12, 0, 0)

function baseline(overrides: Record<string, unknown> = {}) {
  return {
    hostId: '0',
    metric: 'error_rate',
    mean: 100,
    stddev: 10,
    median: 99.5,
    mad: 4,
    sampleCount: 120,
    windowStart: FITTED_AT - 7 * 86400000,
    fittedAt: FITTED_AT,
    ...overrides,
  }
}

function tool(hostId = 0) {
  return (createInsightTools(hostId) as any).explain_anomaly_score
}

async function validate(input: unknown) {
  return (await tool().inputSchema.safeParseAsync(input)) as {
    success: boolean
  }
}

describe('explain_anomaly_score', () => {
  beforeEach(() => {
    mockGetBaseline.mockReset()
    mockUpsertBaseline.mockReset()
    mockGetBaseline.mockResolvedValue(null)
  })

  describe('input schema', () => {
    test('rejects a missing metric', async () => {
      expect((await validate({ value: 1 })).success).toBe(false)
    })

    test('rejects a non-numeric value', async () => {
      expect((await validate({ metric: 'm', value: 'abc' })).success).toBe(
        false
      )
    })

    test('rejects a negative hostId override', async () => {
      expect((await validate({ metric: 'm', hostId: -1 })).success).toBe(false)
    })

    test('accepts metric only and treats empty-string hostId as unset', async () => {
      expect((await validate({ metric: 'm' })).success).toBe(true)
      expect((await validate({ metric: 'm', hostId: '' })).success).toBe(true)
    })
  })

  describe('cold start (no baseline)', () => {
    test('reports hasBaseline=false and explains the static fallback', async () => {
      const res = await tool(2).execute({ metric: 'error_rate', value: 5 })
      expect(res).toEqual({
        hostId: 2,
        metric: 'error_rate',
        hasBaseline: false,
        explanation: expect.stringContaining('static fallback threshold'),
      })
      expect(res.explanation).toContain('"error_rate" on host 2')
      expect(res).not.toHaveProperty('z')
      expect(res).not.toHaveProperty('isAnomaly')
    })
  })

  describe('baseline inspection (no value)', () => {
    test('returns rounded stats and ISO fittedAt without scoring', async () => {
      mockGetBaseline.mockResolvedValue(
        baseline({ mean: 100.456, stddev: 9.994, median: 99.504, mad: 4.006 })
      )
      const res = await tool().execute({ metric: 'error_rate' })

      expect(res.hasBaseline).toBe(true)
      expect(res.mean).toBe(100.46)
      expect(res.stddev).toBe(9.99)
      expect(res.median).toBe(99.5)
      expect(res.mad).toBe(4.01)
      expect(res.sampleCount).toBe(120)
      expect(res.fittedAt).toBe('2026-10-01T12:00:00.000Z')
      expect(res).not.toHaveProperty('z')
      expect(res).not.toHaveProperty('isAnomaly')
      expect(res.explanation).toContain(
        'Pass a value to compute its anomaly score.'
      )
    })
  })

  describe('scoring', () => {
    test('flags a value above the baseline (z=2.5)', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 125 })

      expect(res.z).toBe(2.5)
      expect(res.isAnomaly).toBe(true)
      expect(res.confidence).toBe('high')
      expect(res.value).toBe(125)
      expect(res.explanation).toContain(
        '2.5 standard deviations above the "error_rate" baseline mean (100 ± 10, n=120)'
      )
      expect(res.explanation).toContain(
        'flagged as anomalous (confidence: high)'
      )
    })

    test('flags a value below the baseline with a negative z', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 70 })

      expect(res.z).toBe(-3)
      expect(res.isAnomaly).toBe(true)
      expect(res.explanation).toContain('3 standard deviations below')
    })

    test('|z| == 2 exactly is not anomalous (strict threshold)', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 120 })

      expect(res.z).toBe(2)
      expect(res.isAnomaly).toBe(false)
      expect(res.explanation).toContain('within the normal range')
      expect(res.explanation).toContain('z=2 against baseline mean 100 ± 10')
      expect(res.explanation).toContain('not anomalous')
    })

    test('negative |z| just past the threshold is flagged on the low side', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 79 })

      expect(res.z).toBe(-2.1)
      expect(res.isAnomaly).toBe(true)
    })

    test('rounds z to 2 decimals in both the field and the explanation', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 123.456 })

      expect(res.z).toBe(2.35)
      expect(res.explanation).toContain('2.35 standard deviations above')
    })

    test('a value at the mean scores z=0 and is normal', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 100 })

      expect(res.z).toBe(0)
      expect(res.isAnomaly).toBe(false)
    })

    test('confidence follows the sample count (low < 50 <= medium < 100 <= high)', async () => {
      const conf = async (sampleCount: number) => {
        mockGetBaseline.mockResolvedValue(baseline({ sampleCount }))
        return (await tool().execute({ metric: 'm', value: 130 })).confidence
      }
      expect(await conf(49)).toBe('low')
      expect(await conf(50)).toBe('medium')
      expect(await conf(99)).toBe('medium')
      expect(await conf(100)).toBe('high')
    })

    test('a zero-variance baseline is never flagged (z=0)', async () => {
      mockGetBaseline.mockResolvedValue(baseline({ stddev: 0 }))
      const res = await tool().execute({ metric: 'error_rate', value: 1e6 })

      expect(res.z).toBe(0)
      expect(res.isAnomaly).toBe(false)
    })

    test('value 0 is scored, not treated as "no value"', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool().execute({ metric: 'error_rate', value: 0 })

      expect(res.z).toBe(-10)
      expect(res.isAnomaly).toBe(true)
      expect(res.value).toBe(0)
    })
  })

  describe('host scoping', () => {
    test('uses the factory hostId when no override is given', async () => {
      await tool(3).execute({ metric: 'cpu' })
      expect(mockGetBaseline).toHaveBeenCalledTimes(1)
      expect(mockGetBaseline).toHaveBeenCalledWith('3', 'cpu')
    })

    test('the hostId override wins over the factory hostId', async () => {
      const res = await tool(3).execute({ metric: 'cpu', hostId: 7 })
      expect(mockGetBaseline).toHaveBeenCalledWith('7', 'cpu')
      expect(res.hostId).toBe(7)
      expect(res.explanation).toContain('host 7')
    })

    test('an override of 0 is honoured (not falsy-defaulted)', async () => {
      const res = await tool(3).execute({ metric: 'cpu', hostId: 0 })
      expect(mockGetBaseline).toHaveBeenCalledWith('0', 'cpu')
      expect(res.hostId).toBe(0)
    })

    test('the resolved host is reported on a scored result', async () => {
      mockGetBaseline.mockResolvedValue(baseline())
      const res = await tool(1).execute({ metric: 'error_rate', value: 100 })
      expect(res.hostId).toBe(1)
    })
  })

  describe('error paths and read-only guarantee', () => {
    test('a store failure propagates instead of being reported as cold start', async () => {
      mockGetBaseline.mockRejectedValue(new Error('d1 down'))
      await expect(tool().execute({ metric: 'm' })).rejects.toThrow('d1 down')
    })

    test('never writes or refits a baseline, with or without a value', async () => {
      await tool().execute({ metric: 'm', value: 1 })
      mockGetBaseline.mockResolvedValue(baseline())
      await tool().execute({ metric: 'm' })
      await tool().execute({ metric: 'm', value: 500 })
      expect(mockUpsertBaseline).not.toHaveBeenCalled()
    })
  })
})
