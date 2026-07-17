import type { AlertPayload } from '../types'

import {
  buildPushoverBody,
  buildPushoverMessage,
  pushoverAdapter,
} from '../pushover'
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

describe('buildPushoverMessage — severity → priority', () => {
  test('critical maps to priority 2 (emergency) with retry/expire', () => {
    const msg = buildPushoverMessage(CRITICAL)
    expect(msg.priority).toBe('2')
    expect(msg.retry).toBe('60')
    expect(msg.expire).toBe('3600')
    expect(msg.title).toBe('[CRITICAL] Failed mutations')
  })

  test('warning maps to priority 0 (normal), no retry/expire', () => {
    const msg = buildPushoverMessage(WARNING)
    expect(msg.priority).toBe('0')
    expect(msg.retry).toBeUndefined()
    expect(msg.expire).toBeUndefined()
    expect(msg.title).toBe('[WARNING] Failed mutations')
  })

  test('recovery maps to priority -1 (low, quiet) and RECOVERY heading', () => {
    const msg = buildPushoverMessage(RECOVERY)
    expect(msg.priority).toBe('-1')
    expect(msg.retry).toBeUndefined()
    expect(msg.expire).toBeUndefined()
    expect(msg.title).toBe('[RECOVERY] Failed mutations')
  })
})

describe('buildPushoverMessage — timestamp', () => {
  test('converts the ISO timestamp to Unix seconds', () => {
    const { timestamp } = buildPushoverMessage(CRITICAL)
    expect(timestamp).toBe(
      Math.floor(Date.parse('2026-07-02T10:00:00.000Z') / 1000)
    )
  })

  test('falls back to "now" for an unparseable timestamp', () => {
    const before = Math.floor(Date.now() / 1000)
    const { timestamp } = buildPushoverMessage({
      ...CRITICAL,
      timestamp: 'not-a-date',
    })
    const after = Math.floor(Date.now() / 1000)
    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })
})

describe('buildPushoverMessage — message body', () => {
  test('includes host, metric, value, thresholds, detail', () => {
    const { message } = buildPushoverMessage(CRITICAL)
    expect(message).toContain('Host: prod-1 (id 2)')
    expect(message).toContain('Metric: failed-mutations')
    expect(message).toContain('Value: 7')
    expect(message).toContain('Thresholds: warn 1 | crit 5')
    expect(message).toContain('Detail: 7 failed mutations')
  })

  test('renders n/a for a null value and omits absent thresholds', () => {
    const { message } = buildPushoverMessage({
      ...CRITICAL,
      value: null,
      warnThreshold: null,
      critThreshold: null,
    })
    expect(message).toContain('Value: n/a')
    expect(message).not.toContain('Thresholds:')
  })

  test('lists runbook urls when present, and sets url to the first one', () => {
    const { message, url } = buildPushoverMessage({
      ...CRITICAL,
      runbookUrls: [
        'https://runbook.example/mutations',
        'https://runbook.example/other',
      ],
    })
    expect(message).toContain('Runbooks:')
    expect(message).toContain('- https://runbook.example/mutations')
    expect(url).toBe('https://runbook.example/mutations')
  })

  test('omits url when there are no runbooks', () => {
    const { url } = buildPushoverMessage(CRITICAL)
    expect(url).toBeUndefined()
  })
})

describe('buildPushoverBody', () => {
  test('includes token + user alongside the message fields', () => {
    const body = buildPushoverBody(CRITICAL, {
      token: 'app_tok',
      user: 'usr_key',
    })
    expect(body.token).toBe('app_tok')
    expect(body.user).toBe('usr_key')
    expect(body.title).toBe('[CRITICAL] Failed mutations')
    expect(body.priority).toBe('2')
  })
})

describe('pushoverAdapter', () => {
  test('buildBody returns the rendered message (no token/user)', () => {
    expect(pushoverAdapter.id).toBe('pushover')
    expect(pushoverAdapter.buildBody(CRITICAL)).toEqual(
      buildPushoverMessage(CRITICAL)
    )
  })

  test('has no URL detector (dispatched by config, not URL routing)', () => {
    expect(pushoverAdapter.detect).toBeUndefined()
  })
})
