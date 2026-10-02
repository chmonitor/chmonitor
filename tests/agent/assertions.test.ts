import { isInfraSkip, noToolCalled, toolCalled } from './assertions.js'
import { describe, expect, test } from 'bun:test'

const ctx = (tools?: string[]) => ({ config: { tools } })

describe('toolCalled', () => {
  test('passes when any wanted tool ran', () => {
    const out = '[tool:get_replication_status]\nAll replicas are in sync.'
    expect(toolCalled(out, ctx(['query', 'get_replication_status'])).pass).toBe(
      true
    )
  })

  test('fails when only an unrelated tool ran', () => {
    const out = '[tool:list_databases]\nHere you go.'
    expect(toolCalled(out, ctx(['get_table_parts'])).pass).toBe(false)
  })

  test('fails when the model answered without any tool', () => {
    expect(toolCalled('It is probably 24.8.', ctx(['get_metrics'])).pass).toBe(
      false
    )
  })

  test('treats a 1033 demo outage as an infra skip, not a failure', () => {
    const out = '[tool:get_metrics]\n[tool-error:get_metrics: error code: 1033]'
    expect(isInfraSkip(out)).toBe(true)
    const res = toolCalled(out, ctx(['query']))
    expect(res.pass).toBe(true)
    expect(res.reason).toContain('infra skip')
  })

  test('a non-infra tool error is a real failure', () => {
    const out = '[tool:query]\n[tool-error:query: Unknown column foo]'
    expect(isInfraSkip(out)).toBe(false)
    expect(toolCalled(out, ctx(['query'])).pass).toBe(false)
  })
})

describe('noToolCalled', () => {
  test('passes for a plain answer, fails once a tool ran', () => {
    expect(noToolCalled('I only help with ClickHouse.').pass).toBe(true)
    expect(noToolCalled('[tool:query]\nrows').pass).toBe(false)
  })
})
