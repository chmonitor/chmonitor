/**
 * Contract: the plain `{ text, content }` wrapper (generic webhook URLs, Slack
 * URLs without the Slack app, `auto` custom targets) carries the dashboard
 * link like every rich body does. message-completeness.test.ts covers the
 * adapter builders; this covers the wrapper.
 */

import type { AlertPayload } from '../types'

import { buildCustomTargetBody } from '../../custom-webhook-targets'
import { buildWebhookDispatchBody } from '../index'
import { describe, expect, test } from 'bun:test'

const LINK = 'https://chm.example.com/health?host=4217'

const PAYLOAD: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-eu-1',
  hostId: 4217,
  metric: 'disk-usage',
  value: 97.25,
  title: 'Disk almost full',
  label: 'data volume nearly full',
  timestamp: '2026-07-02T10:00:00.000Z',
  instanceName: 'prod-eu',
  dashboardUrl: LINK,
}

const TEXT = '[prod-eu] [CRITICAL] Disk almost full (host prod-eu-1)'

function wrapperText(body: unknown): string {
  const b = body as { text: string; content: string }
  expect(b.content).toBe(b.text)
  return b.text
}

describe('the one-line wrapper shows the dashboard link', () => {
  for (const [name, url] of [
    ['generic webhook', 'https://hooks.example.com/alerts'],
    ['slack URL without the app', 'https://hooks.slack.com/services/T/B/x'],
  ] as const) {
    test(name, () => {
      const { body } = buildWebhookDispatchBody({
        url,
        text: TEXT,
        payload: PAYLOAD,
      })
      const text = wrapperText(body)
      expect(text).toContain(TEXT)
      expect(text).toContain(LINK)
    })
  }

  test('auto custom target', () => {
    const { body } = buildCustomTargetBody(
      {
        url: 'https://hooks.example.com/alerts',
        format: 'auto',
        titleTemplate: '',
        bodyTemplate: '',
      },
      PAYLOAD,
      TEXT
    )
    expect(wrapperText(body)).toContain(LINK)
  })

  test('stays the bare summary when no dashboard URL is configured', () => {
    const { dashboardUrl: _omit, ...bare } = PAYLOAD
    const { body } = buildWebhookDispatchBody({
      url: 'https://hooks.example.com/alerts',
      text: TEXT,
      payload: bare,
    })
    expect(body).toEqual({ text: TEXT, content: TEXT })
  })
})
