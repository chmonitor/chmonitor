import { bindToolsToAttribution } from './bind-tools'
import { describe, expect, it } from 'bun:test'
import {
  currentAttributionScope,
  runWithAttribution,
} from '@chm/clickhouse-client/attribution'

describe('bindToolsToAttribution', () => {
  it('keeps the request principal when a tool runs after the request scope ended', async () => {
    const principal = async () => ({ subject: 'jane' })
    const tools = runWithAttribution(
      { principal, source: 'api:/api/v1/agent', page: '/overview' },
      () =>
        bindToolsToAttribution({
          probe: { execute: async () => currentAttributionScope() },
          plain: { description: 'no execute' },
        })
    )

    expect(currentAttributionScope()).toBeUndefined()
    const scope = await tools.probe.execute()
    expect(scope?.source).toBe('agent')
    expect(scope?.page).toBe('/overview')
    expect(await scope?.principal?.()).toEqual({ subject: 'jane' })
    expect(tools.plain).toEqual({ description: 'no execute' })
  })
})
