import { mockFetchData } from './shared-mocks'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

type BuildArgs = [number, string, string]
const buildCalls: BuildArgs[] = []
let buildImpl: (...args: BuildArgs) => Promise<unknown>

mock.module('@/lib/insights/weekly-report', () => ({
  buildWeeklyReport: (...args: BuildArgs) => {
    buildCalls.push(args)
    return buildImpl(...args)
  },
}))

const { createReportTools } = await import('../report-tools')

const okReport = {
  summary: { findings: 3 },
  markdown: '# Report',
  html: '<html>never returned</html>',
}

// biome-ignore lint/suspicious/noExplicitAny: dynamicTool typing is opaque in tests
function getTool(hostId = 0): any {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  return (createReportTools(hostId) as any).generate_cluster_report
}

describe('createReportTools', () => {
  beforeEach(() => {
    buildCalls.length = 0
    mockFetchData.mockReset()
    buildImpl = async () => okReport
  })

  test('exposes only generate_cluster_report', () => {
    expect(Object.keys(createReportTools(0))).toEqual([
      'generate_cluster_report',
    ])
  })

  describe('inputSchema', () => {
    test('defaults period to weekly and hostId to undefined', () => {
      const parsed = getTool().inputSchema.parse({})
      expect(parsed.period).toBe('weekly')
      expect(parsed.hostId).toBeUndefined()
    })

    test('accepts monthly', () => {
      expect(getTool().inputSchema.parse({ period: 'monthly' }).period).toBe(
        'monthly'
      )
    })

    test('rejects unknown periods', () => {
      expect(getTool().inputSchema.safeParse({ period: 'daily' }).success).toBe(
        false
      )
    })

    test('rejects negative and fractional hostId', () => {
      const schema = getTool().inputSchema
      expect(schema.safeParse({ hostId: -1 }).success).toBe(false)
      expect(schema.safeParse({ hostId: 1.5 }).success).toBe(false)
    })

    test('treats null/blank hostId as unset and coerces numeric strings', () => {
      const schema = getTool().inputSchema
      expect(schema.parse({ hostId: null }).hostId).toBeUndefined()
      expect(schema.parse({ hostId: '  ' }).hostId).toBeUndefined()
      expect(schema.parse({ hostId: '4' }).hostId).toBe(4)
    })
  })

  describe('execute', () => {
    test('returns only summary and markdown, never html', async () => {
      const result = await getTool().execute({})
      expect(result).toEqual({
        summary: okReport.summary,
        markdown: okReport.markdown,
      })
      expect(result).not.toHaveProperty('html')
    })

    test('defaults to the weekly period', async () => {
      await getTool(2).execute({})
      expect(buildCalls).toHaveLength(1)
      expect(buildCalls[0][2]).toBe('weekly')
    })

    test('forwards the monthly period', async () => {
      await getTool(2).execute({ period: 'monthly' })
      expect(buildCalls[0][2]).toBe('monthly')
    })

    test('uses the factory hostId and labels the report with it', async () => {
      await getTool(3).execute({})
      expect(buildCalls[0][0]).toBe(3)
      expect(buildCalls[0][1]).toBe('Host 3')
    })

    test('hostId override wins over the factory host, including 0', async () => {
      await getTool(3).execute({ hostId: 7 })
      expect(buildCalls[0][0]).toBe(7)
      expect(buildCalls[0][1]).toBe('Host 7')

      await getTool(3).execute({ hostId: 0 })
      expect(buildCalls[1][0]).toBe(0)
      expect(buildCalls[1][1]).toBe('Host 0')
    })

    test('is read-only: issues no queries itself', async () => {
      await getTool().execute({ period: 'monthly' })
      expect(mockFetchData).not.toHaveBeenCalled()
    })

    test('propagates builder errors instead of swallowing them', async () => {
      buildImpl = async () => {
        throw new Error('clickhouse unreachable')
      }
      await expect(getTool().execute({})).rejects.toThrow(
        'clickhouse unreachable'
      )
    })
  })
})
