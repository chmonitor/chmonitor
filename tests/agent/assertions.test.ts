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

const CPU_LIMIT_PAGE =
  '<!DOCTYPE html>\n<html><head><title>Worker exceeded resource limits | dash.chmonitor.dev | Cloudflare</title></head><body>Error 1102</body></html>'
const ORIGIN_1033_PAGE =
  '<!DOCTYPE html>\n<html><head><title>Cloudflare Tunnel error</title></head><body>Error 1033 Argo Tunnel error</body></html>'
const TRUNCATED_STREAM =
  'data: {"type":"start","messageId":"x"}\n\ndata: {"type":"start-step"}'

const ALL_HELPERS = (out: string) => [
  toolCalled(out, ctx(['query'])),
  noToolCalled(out),
  noStreamError(out),
  answerMatches(out, { config: { pattern: 'x' } }),
]

describe('infra skips: demo origin and model router only', () => {
  const skips = {
    'origin 1033 HTML page': ORIGIN_1033_PAGE,
    '502 gateway HTML page':
      '<html><head><title>502 Bad Gateway</title></head></html>',
    'truncated stream carrying a 1033 marker': `${TRUNCATED_STREAM}\ndata: {"type":"error","errorText":"error code: 1033"}`,
    'router stream error':
      '[error:No output generated. The model stream ended without a finish chunk.]',
    'provider 502 tool error':
      '[tool:query]\n[tool-error:query: error code: 502 — provider]',
  }
  for (const [name, out] of Object.entries(skips)) {
    test(`${name} is skipped by every helper`, () => {
      expect(isInfraSkip(out)).toBe(true)
      for (const r of ALL_HELPERS(out)) {
        expect(r.pass).toBe(true)
        expect(r.reason).toContain('infra skip')
      }
    })
  }
})

describe('our own faults are never skipped', () => {
  test('Worker CPU/resource-limit page fails with a clear reason', () => {
    expect(isInfraSkip(CPU_LIMIT_PAGE)).toBe(false)
    for (const r of ALL_HELPERS(CPU_LIMIT_PAGE)) {
      expect(r.pass).toBe(false)
      expect(r.reason).toBe('worker CPU/resource limit')
    }
  })

  test.each([
    'Error 1101',
    'Worker threw exception',
    'error code: 1102',
  ])('%s fails as a Worker fault, even next to a 502 marker', (marker) => {
    const out = `<html><body>${marker} 502 Bad Gateway</body></html>`
    expect(noStreamError(out).reason).toBe('worker CPU/resource limit')
    expect(noStreamError(out).pass).toBe(false)
  })

  test('a truncated stream without an infra marker fails', () => {
    expect(isInfraSkip(TRUNCATED_STREAM)).toBe(false)
    for (const r of ALL_HELPERS(TRUNCATED_STREAM)) {
      expect(r.pass).toBe(false)
      expect(r.reason).toBe('stream truncated')
    }
  })

  test('an unrecognised HTML page fails', () => {
    const out = '<!DOCTYPE html><html><body>Just a moment...</body></html>'
    for (const r of ALL_HELPERS(out)) expect(r.pass).toBe(false)
  })

  test('an empty body fails', () => {
    for (const r of ALL_HELPERS('')) {
      expect(r.pass).toBe(false)
      expect(r.reason).toBe('empty response')
    }
  })

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
