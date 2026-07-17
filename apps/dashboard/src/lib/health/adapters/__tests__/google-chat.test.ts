/**
 * Unit tests for the Google Chat notification adapter (pure formatter).
 *
 * Asserts the `cardsV2` envelope shape Google Chat Incoming Webhooks expect:
 *   - `text` fallback + one `cardsV2` card
 *   - severity → heading emoji (🔴 / 🟠 / 🟢), recovery renders RESOLVED
 *   - host/metric/value/thresholds as `decoratedText` widgets, timestamp present
 *   - runbook urls rendered as links, omitted when absent
 *   - URL detection for `chat.googleapis.com`
 *
 * Runs in Bun's test runner — everything here is pure (no transport).
 */

import type { AlertPayload } from '@/lib/health/adapters'

import { describe, expect, test } from 'bun:test'
import { buildGoogleChatBody, googleChatAdapter } from '@/lib/health/adapters'

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
  runbookUrls: ['https://docs.example.com/runbook/mutations'],
  timestamp: '2026-07-16T10:00:00.000Z',
}

const WARNING: AlertPayload = {
  ...CRITICAL,
  severity: 'warning',
  value: 2,
  label: '2 failed mutations',
}

const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 0,
  label: 'resolved',
}

function card(payload: AlertPayload) {
  return buildGoogleChatBody(payload).cardsV2[0].card
}

function widgetText(
  payload: AlertPayload,
  topLabel: string
): string | undefined {
  const widgets = card(payload).sections[0].widgets
  for (const widget of widgets) {
    if (
      'decoratedText' in widget &&
      widget.decoratedText.topLabel === topLabel
    ) {
      return widget.decoratedText.text
    }
  }
  return undefined
}

describe('google-chat adapter', () => {
  test('wraps a cardsV2 card in the webhook envelope alongside a text fallback', () => {
    const body = buildGoogleChatBody(CRITICAL)
    expect(body.text).toBe(
      '[CRITICAL] Failed mutations — 7 failed mutations (host prod-1)'
    )
    expect(body.cardsV2).toHaveLength(1)
    expect(body.cardsV2[0].cardId).toBe('chmonitor-alert')
    expect(body.cardsV2[0].card.sections).toHaveLength(1)
  })

  test('critical heading uses 🔴, warning uses 🟠', () => {
    expect(card(CRITICAL).header.title).toContain('🔴')
    expect(card(CRITICAL).header.title).toBe('🔴 CRITICAL: Failed mutations')
    expect(card(WARNING).header.title).toContain('🟠')
    expect(card(WARNING).header.title).toBe('🟠 WARNING: Failed mutations')
  })

  test('recovery renders a green-circle RESOLVED heading', () => {
    expect(card(RECOVERY).header.title).toContain('🟢')
    expect(card(RECOVERY).header.title).toBe('🟢 RESOLVED: Failed mutations')
  })

  test('header subtitle carries the alert label', () => {
    expect(card(CRITICAL).header.subtitle).toBe('7 failed mutations')
  })

  test('decoratedText widgets carry host, metric, value, thresholds', () => {
    expect(widgetText(CRITICAL, 'Host')).toBe('prod-1 (id 2)')
    expect(widgetText(CRITICAL, 'Metric')).toBe('failed-mutations')
    expect(widgetText(CRITICAL, 'Value')).toBe('7')
    expect(widgetText(CRITICAL, 'Thresholds')).toBe('warn 1 | crit 5')
  })

  test('null value renders n/a in the Value widget', () => {
    expect(widgetText({ ...CRITICAL, value: null }, 'Value')).toBe('n/a')
  })

  test('missing thresholds render the em-dash placeholder', () => {
    expect(
      widgetText(
        { ...CRITICAL, warnThreshold: null, critThreshold: null },
        'Thresholds'
      )
    ).toBe('—')
  })

  test('timestamp is present as a textParagraph widget', () => {
    const widgets = card(CRITICAL).sections[0].widgets
    const timestampWidget = widgets.find(
      (w) => 'textParagraph' in w && w.textParagraph.text === CRITICAL.timestamp
    )
    expect(timestampWidget).toBeDefined()
  })

  test('includes runbook urls as links when present, omits the block otherwise', () => {
    const runbookWidget = card(CRITICAL).sections[0].widgets.find(
      (w) => 'textParagraph' in w && w.textParagraph.text.includes('Runbooks')
    )
    expect(runbookWidget).toBeDefined()
    // Assert on the widget text itself, not JSON.stringify output — the
    // serialized form escapes the href quotes.
    expect(
      runbookWidget && 'textParagraph' in runbookWidget
        ? runbookWidget.textParagraph.text
        : ''
    ).toContain(
      '<a href="https://docs.example.com/runbook/mutations">https://docs.example.com/runbook/mutations</a>'
    )

    const { runbookUrls: _drop, ...withoutRunbooks } = CRITICAL
    const serialized = JSON.stringify(card(withoutRunbooks))
    expect(serialized).not.toContain('Runbooks')
  })
})

describe('googleChatAdapter.detect', () => {
  test('matches Google Chat incoming-webhook URLs (chat.googleapis.com)', () => {
    expect(
      googleChatAdapter.detect?.(
        'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=x&token=y'
      )
    ).toBe(true)
  })

  test('does not match other webhook hosts', () => {
    expect(
      googleChatAdapter.detect?.('https://hooks.slack.com/services/x')
    ).toBe(false)
    expect(
      googleChatAdapter.detect?.('https://discord.com/api/webhooks/1/abc')
    ).toBe(false)
    expect(
      googleChatAdapter.detect?.(
        'https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/x/y'
      )
    ).toBe(false)
    expect(googleChatAdapter.detect?.('https://example.com/webhook')).toBe(
      false
    )
    // A lookalike host must not match (anchored to the real domain).
    expect(
      googleChatAdapter.detect?.(
        'https://evil-chat.googleapis.com.attacker.test/x'
      )
    ).toBe(false)
  })
})
