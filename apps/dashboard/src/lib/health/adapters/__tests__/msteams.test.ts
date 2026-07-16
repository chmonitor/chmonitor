/**
 * Unit tests for the Microsoft Teams notification adapter (pure formatter).
 *
 * Asserts the Adaptive Card envelope shape Teams Incoming Webhooks / Workflows
 * expect:
 *   - `type: 'message'` + an `application/vnd.microsoft.card.adaptive` attachment
 *   - severity → heading colour (attention / warning / good) + emoji
 *   - host/metric/value/thresholds in a FactSet, timestamp present
 *   - recovery variant renders a green RESOLVED heading
 *   - URL detection for `*.webhook.office.com` + `*.logic.azure.com` (Workflows)
 *
 * Runs in Bun's test runner — everything here is pure (no transport).
 */

import type { AlertPayload } from '@/lib/health/adapters'

import { describe, expect, test } from 'bun:test'
import { buildMSTeamsBody, msTeamsAdapter } from '@/lib/health/adapters'

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
  return buildMSTeamsBody(payload).attachments[0].content
}

function factValue(payload: AlertPayload, title: string): string | undefined {
  const factSet = card(payload).body.find((el) => el.type === 'FactSet') as
    | { type: 'FactSet'; facts: { title: string; value: string }[] }
    | undefined
  return factSet?.facts.find((f) => f.title === title)?.value
}

function heading(payload: AlertPayload) {
  return card(payload).body[0] as { text: string; color: string }
}

describe('msteams adapter', () => {
  test('wraps an Adaptive Card in the modern message envelope', () => {
    const body = buildMSTeamsBody(CRITICAL)
    expect(body.type).toBe('message')
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive'
    )
    expect(body.attachments[0].content.type).toBe('AdaptiveCard')
    expect(body.attachments[0].content.version).toBe('1.4')
  })

  test('critical heading uses the attention colour + 🔴, warning uses warning', () => {
    expect(heading(CRITICAL).color).toBe('attention')
    expect(heading(CRITICAL).text).toContain('🔴')
    expect(heading(CRITICAL).text).toContain('CRITICAL: Failed mutations')
    expect(heading(WARNING).color).toBe('warning')
    expect(heading(WARNING).text).toContain('🟠')
  })

  test('recovery renders a green RESOLVED heading', () => {
    expect(heading(RECOVERY).color).toBe('good')
    expect(heading(RECOVERY).text).toContain('🟢')
    expect(heading(RECOVERY).text).toContain('RESOLVED: Failed mutations')
  })

  test('FactSet carries host, metric, value, thresholds', () => {
    expect(factValue(CRITICAL, 'Host')).toBe('prod-1 (id 2)')
    expect(factValue(CRITICAL, 'Metric')).toBe('failed-mutations')
    expect(factValue(CRITICAL, 'Value')).toBe('7')
    expect(factValue(CRITICAL, 'Thresholds')).toBe('warn 1 | crit 5')
  })

  test('null value renders n/a in the FactSet', () => {
    expect(factValue({ ...CRITICAL, value: null }, 'Value')).toBe('n/a')
  })

  test('timestamp is present as a subtle TextBlock', () => {
    const timestampBlock = card(CRITICAL).body.find(
      (el) => el.type === 'TextBlock' && el.text === CRITICAL.timestamp
    )
    expect(timestampBlock).toBeDefined()
  })

  test('includes runbook urls when present, omits the block otherwise', () => {
    const withRunbooks = JSON.stringify(card(CRITICAL))
    expect(withRunbooks).toContain('https://docs.example.com/runbook/mutations')

    const { runbookUrls: _drop, ...withoutRunbooks } = CRITICAL
    const serialized = JSON.stringify(card(withoutRunbooks))
    expect(serialized).not.toContain('Runbooks')
  })

  test('snapshot', () => {
    expect(buildMSTeamsBody(CRITICAL)).toMatchSnapshot()
  })
})

describe('msTeamsAdapter.detect', () => {
  test('matches classic Teams incoming-webhook URLs (*.webhook.office.com)', () => {
    expect(
      msTeamsAdapter.detect?.(
        'https://acme.webhook.office.com/webhookb2/abc-123@def-456/IncomingWebhook/xyz/guid'
      )
    ).toBe(true)
  })

  test('matches Workflows / Power Automate URLs (*.logic.azure.com, incl. :443)', () => {
    expect(
      msTeamsAdapter.detect?.(
        'https://prod-42.westus.logic.azure.com:443/workflows/guid/triggers/manual/paths/invoke?sig=x'
      )
    ).toBe(true)
  })

  test('does not match other webhook hosts', () => {
    expect(msTeamsAdapter.detect?.('https://hooks.slack.com/services/x')).toBe(
      false
    )
    expect(
      msTeamsAdapter.detect?.('https://discord.com/api/webhooks/1/abc')
    ).toBe(false)
    expect(msTeamsAdapter.detect?.('https://example.com/webhook')).toBe(false)
    // A lookalike host must not match (anchored to the real domains).
    expect(
      msTeamsAdapter.detect?.('https://evil-webhook.office.com.attacker.test/x')
    ).toBe(false)
  })
})
