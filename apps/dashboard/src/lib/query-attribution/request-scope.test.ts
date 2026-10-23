import {
  pageFromReferer,
  requestAttributionScope,
  sourceFromPath,
} from './request-scope'
import { describe, expect, it } from 'bun:test'

describe('sourceFromPath', () => {
  it.each([
    ['/api/v1/charts/query-count', 'chart:query-count'],
    ['/api/v1/charts/batch', 'chart:batch'],
    ['/api/v1/tables/running-queries', 'table:running-queries'],
    ['/api/v1/tables/parts/filter-options', 'table:parts'],
    ['/api/v1/explorer/query', 'console'],
    ['/api/v1/explorer/tables', 'explorer:tables'],
    ['/api/v1/agent', 'agent'],
    ['/api/mcp', 'mcp'],
    ['/api/cron/health-sweep', 'cron:health-sweep'],
    ['/api/v1/host-status', 'api:/api/v1/host-status'],
  ])('%s -> %s', (path, source) => {
    expect(sourceFromPath(path)).toBe(source)
  })
})

describe('pageFromReferer', () => {
  const url = 'https://dash.example.com/api/v1/charts/x'

  it('keeps the path of a same-origin page', () => {
    expect(
      pageFromReferer('https://dash.example.com/overview?host=0', url)
    ).toBe('/overview')
  })

  it('ignores cross-origin and malformed referrers', () => {
    expect(pageFromReferer('https://evil.example/overview', url)).toBeNull()
    expect(pageFromReferer('not a url */', url)).toBeNull()
    expect(pageFromReferer(null, url)).toBeNull()
  })
})

describe('requestAttributionScope', () => {
  it('resolves the principal at most once, and only on demand', async () => {
    let calls = 0
    const scope = requestAttributionScope(
      new Request('https://d.example/api/cron/weekly-report'),
      async () => {
        calls++
        return { subject: 'jane' }
      }
    )
    expect(calls).toBe(0)
    await scope.principal?.()
    await scope.principal?.()
    expect(calls).toBe(1)
    expect(scope.source).toBe('cron:weekly-report')
  })
})
