import {
  answerMatches,
  isInfraSkip,
  noStreamError,
  noToolCalled,
  toolCalled,
} from './assertions.js'
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

describe('upstream model failures are infra skips', () => {
  const failures = {
    'empty body': '',
    'cloudflare html': '<!DOCTYPE html>\n<html>Just a moment</html>',
    'reasoning-only stream (parser fallback)':
      'data: {"type":"start","messageId":"x"}\n\ndata: {"type":"start-step"}',
    'router stream error':
      '[error:No output generated. The model stream ended without a finish chunk.]',
    'provider 502':
      '[tool:query]\n[tool-error:query: error code: 502 — provider]',
  }
  for (const [name, out] of Object.entries(failures)) {
    test(name, () => {
      expect(isInfraSkip(out)).toBe(true)
      expect(toolCalled(out, ctx(['query'])).pass).toBe(true)
      expect(noToolCalled(out).pass).toBe(true)
      expect(noStreamError(out).pass).toBe(true)
      expect(answerMatches(out, { config: { pattern: 'x' } }).pass).toBe(true)
    })
  }

  test('a model that answered without tools is still a real failure', () => {
    expect(isInfraSkip('It is probably 24.8.')).toBe(false)
  })
})

describe('noStreamError', () => {
  test('a non-infra stream error fails; a clean answer passes', () => {
    expect(noStreamError('[tool:query]\n[error:schema exploded]').pass).toBe(
      false
    )
    expect(noStreamError('All good.').pass).toBe(true)
  })
})

describe('answerMatches', () => {
  test('matches case-insensitively and fails on a real miss', () => {
    const ctxp = { config: { pattern: 'max_threads' } }
    expect(answerMatches('Current MAX_THREADS is 8', ctxp).pass).toBe(true)
    expect(answerMatches('I am not sure.', ctxp).pass).toBe(false)
  })
})
