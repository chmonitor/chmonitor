import type { AlertPayload } from '../types'

import {
  buildNtfyHeaders,
  buildNtfyMessage,
  ntfyAdapter,
  sanitizeHeaderValue,
} from '../ntfy'
import { describe, expect, test } from 'bun:test'

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 7,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '7 failed mutations',
  timestamp: '2026-07-02T10:00:00.000Z',
}

const WARNING: AlertPayload = { ...CRITICAL, severity: 'warning', value: 3 }
const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 0,
  label: 'recovered',
}

describe('buildNtfyMessage — severity → priority/tags', () => {
  test('critical maps to priority 5 + siren tag', () => {
    const msg = buildNtfyMessage(CRITICAL)
    expect(msg.priority).toBe('5')
    expect(msg.tags).toBe('rotating_light')
    expect(msg.title).toBe('[CRITICAL] Failed mutations')
  })

  test('warning maps to priority 4 + warning tag', () => {
    const msg = buildNtfyMessage(WARNING)
    expect(msg.priority).toBe('4')
    expect(msg.tags).toBe('warning')
    expect(msg.title).toBe('[WARNING] Failed mutations')
  })

  test('recovery maps to priority 3 + check-mark tag and RECOVERY heading', () => {
    const msg = buildNtfyMessage(RECOVERY)
    expect(msg.priority).toBe('3')
    expect(msg.tags).toBe('white_check_mark')
    expect(msg.title).toBe('[RECOVERY] Failed mutations')
  })
})

describe('buildNtfyMessage — body', () => {
  test('includes host, metric, value, thresholds, detail and timestamp', () => {
    const { body } = buildNtfyMessage(CRITICAL)
    expect(body).toContain('Host: prod-1 (id 2)')
    expect(body).toContain('Metric: failed-mutations')
    expect(body).toContain('Value: 7')
    expect(body).toContain('Thresholds: warn 1 | crit 5')
    expect(body).toContain('Detail: 7 failed mutations')
    expect(body).toContain('2026-07-02T10:00:00.000Z')
  })

  test('renders n/a for a null value and omits absent thresholds', () => {
    const { body } = buildNtfyMessage({
      ...CRITICAL,
      value: null,
      warnThreshold: null,
      critThreshold: null,
    })
    expect(body).toContain('Value: n/a')
    expect(body).not.toContain('Thresholds:')
  })

  test('lists runbook urls when present', () => {
    const { body } = buildNtfyMessage({
      ...CRITICAL,
      runbookUrls: ['https://runbook.example/mutations'],
    })
    expect(body).toContain('Runbooks:')
    expect(body).toContain('- https://runbook.example/mutations')
  })
})

describe('buildNtfyHeaders', () => {
  test('emits Title/Priority/Tags and no Authorization without a token', () => {
    const headers = buildNtfyHeaders(CRITICAL)
    expect(headers.Title).toBe('[CRITICAL] Failed mutations')
    expect(headers.Priority).toBe('5')
    expect(headers.Tags).toBe('rotating_light')
    expect(headers.Authorization).toBeUndefined()
  })

  test('adds a Bearer Authorization header when a token is supplied', () => {
    const headers = buildNtfyHeaders(CRITICAL, 'tk_secret')
    expect(headers.Authorization).toBe('Bearer tk_secret')
  })

  test('ignores a blank/whitespace token', () => {
    const headers = buildNtfyHeaders(CRITICAL, '   ')
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('sanitizeHeaderValue', () => {
  test('drops non-ASCII and control characters, collapsing whitespace', () => {
    expect(sanitizeHeaderValue('café \n\t crash')).toBe('caf crash')
    expect(sanitizeHeaderValue('[CRITICAL] disk 🚨 full')).toBe(
      '[CRITICAL] disk full'
    )
  })

  test('keeps a plain ASCII title untouched', () => {
    expect(sanitizeHeaderValue('[WARNING] Failed mutations')).toBe(
      '[WARNING] Failed mutations'
    )
  })
})

describe('ntfyAdapter', () => {
  test('buildBody returns the plain-text message body', () => {
    expect(ntfyAdapter.id).toBe('ntfy')
    expect(ntfyAdapter.buildBody(CRITICAL)).toBe(
      buildNtfyMessage(CRITICAL).body
    )
  })

  test('has no URL detector (dispatched by config, not URL routing)', () => {
    expect(ntfyAdapter.detect).toBeUndefined()
  })
})
