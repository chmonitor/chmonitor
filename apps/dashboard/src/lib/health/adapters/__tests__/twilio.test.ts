import type { AlertPayload } from '../types'

import {
  buildTwilioMessage,
  TWILIO_SMS_MAX_LENGTH,
  truncateSmsBody,
  twilioAdapter,
} from '../twilio'
import { describe, expect, test } from 'bun:test'

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'disk-usage',
  value: 92,
  warnThreshold: 80,
  critThreshold: 90,
  title: 'disk-usage',
  label: '92%',
  timestamp: '2026-07-02T10:00:00.000Z',
}

const WARNING: AlertPayload = {
  ...CRITICAL,
  severity: 'warning',
  value: 85,
  label: '85%',
}
const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 40,
  label: 'recovered',
}

describe('buildTwilioMessage', () => {
  test('renders "[SEVERITY] title on host: label"', () => {
    expect(buildTwilioMessage(CRITICAL)).toBe(
      '[CRITICAL] disk-usage on prod-1: 92%'
    )
  })

  test('uppercases warning', () => {
    expect(buildTwilioMessage(WARNING)).toBe(
      '[WARNING] disk-usage on prod-1: 85%'
    )
  })

  test('renders RECOVERY heading for a resolved incident', () => {
    expect(buildTwilioMessage(RECOVERY)).toBe(
      '[RECOVERY] disk-usage on prod-1: recovered'
    )
  })

  test('never exceeds the Twilio SMS character limit', () => {
    const longLabel = 'x'.repeat(2000)
    const text = buildTwilioMessage({ ...CRITICAL, label: longLabel })
    expect(text.length).toBeLessThanOrEqual(TWILIO_SMS_MAX_LENGTH)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('truncateSmsBody', () => {
  test('is a no-op when the text already fits', () => {
    expect(truncateSmsBody('short message')).toBe('short message')
  })

  test('truncates and appends an ellipsis when over the limit', () => {
    const text = 'a'.repeat(20)
    const result = truncateSmsBody(text, 10)
    expect(result).toHaveLength(10)
    expect(result).toBe(`${'a'.repeat(9)}…`)
  })

  test('defaults to the Twilio 1600-character limit', () => {
    const text = 'a'.repeat(TWILIO_SMS_MAX_LENGTH + 500)
    const result = truncateSmsBody(text)
    expect(result).toHaveLength(TWILIO_SMS_MAX_LENGTH)
  })
})

describe('twilioAdapter', () => {
  test('buildBody returns the SMS body text', () => {
    expect(twilioAdapter.id).toBe('twilio')
    expect(twilioAdapter.buildBody(CRITICAL)).toBe(buildTwilioMessage(CRITICAL))
  })

  test('has no URL detector (dispatched by env config, not URL routing)', () => {
    expect(twilioAdapter.detect).toBeUndefined()
  })
})
