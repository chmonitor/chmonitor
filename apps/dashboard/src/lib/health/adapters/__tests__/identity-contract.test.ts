/**
 * Contract: every channel that can carry deployment identity must render
 * `instanceName`, `dashboardUrl` and `metadata` when set (issue #3799). Slack
 * and the generic channels already do; this guards the paging/SMS/email ones
 * from silently dropping it again. A new adapter must be added here.
 */

import type { AlertPayload } from '../types'

import { buildEmailBody } from '../email'
import { buildHookshotBody } from '../hookshot'
import { buildOpsgenieBody } from '../opsgenie'
import { buildPagerDutyBody, pagerDutyDedupKey } from '../pagerduty'
import { buildPushoverMessage } from '../pushover'
import { buildSlackBody } from '../slack'
import { buildTwilioMessage, TWILIO_SMS_MAX_LENGTH } from '../twilio'
import { describe, expect, test } from 'bun:test'

const BASE: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'disk-usage',
  value: 92,
  warnThreshold: 80,
  critThreshold: 90,
  title: 'Disk usage',
  label: '92%',
  timestamp: '2026-07-02T10:00:00.000Z',
}

const IDENTITY = {
  instanceName: 'prod-eu',
  dashboardUrl: 'https://dash.example.com/health?host=2',
  metadata: { team: 'db', region: 'eu' },
}

const WITH_IDENTITY: AlertPayload = { ...BASE, ...IDENTITY }

const ADAPTERS: Record<string, (p: AlertPayload) => unknown> = {
  slack: buildSlackBody,
  hookshot: buildHookshotBody,
  pagerduty: (p) => buildPagerDutyBody(p, { routingKey: 'k' }),
  opsgenie: buildOpsgenieBody,
  email: buildEmailBody,
  pushover: buildPushoverMessage,
  twilio: buildTwilioMessage,
}

describe.each(Object.entries(ADAPTERS))('%s identity', (_name, build) => {
  test('renders instance, dashboard link and metadata when set', () => {
    const out = JSON.stringify(build(WITH_IDENTITY))
    expect(out).toContain('prod-eu')
    expect(out).toContain(IDENTITY.dashboardUrl)
    expect(out).toContain('team')
    expect(out).toContain('region')
  })

  test('is unchanged when no identity is set', () => {
    const out = JSON.stringify(build(BASE))
    expect(out).not.toContain('prod-eu')
    expect(out).not.toContain('dash.example.com')
  })
})

describe('pagerduty identity', () => {
  test('keeps dedup_key independent of the instance', () => {
    expect(
      buildPagerDutyBody(WITH_IDENTITY, { routingKey: 'k' }).dedup_key
    ).toBe(pagerDutyDedupKey(BASE))
  })

  test('puts the instance in a readable source and custom_details', () => {
    const body = buildPagerDutyBody(WITH_IDENTITY, { routingKey: 'k' })
    expect(body.payload.source).toBe('prod-eu/prod-1')
    expect(body.payload.custom_details).toMatchObject(IDENTITY)
  })
})

describe('twilio identity', () => {
  test('keeps identity when the head is truncated to the SMS cap', () => {
    const msg = buildTwilioMessage({
      ...WITH_IDENTITY,
      label: 'x'.repeat(3000),
    })
    expect(msg.length).toBeLessThanOrEqual(TWILIO_SMS_MAX_LENGTH)
    expect(msg).toContain(IDENTITY.dashboardUrl)
    expect(msg).toContain('team=db')
  })
})

describe('opsgenie identity', () => {
  test('metadata cannot overwrite a fixed detail key', () => {
    const body = buildOpsgenieBody({
      ...BASE,
      metadata: { metric: 'spoofed' },
    })
    expect(body.details.metric).toBe('disk-usage')
  })
})
