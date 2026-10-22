/**
 * Opt-in `details` for custom webhook targets (#4049). The contract that
 * matters: with `details` off the request body is byte-identical to what a
 * target sent before the option existed.
 */

import type { AlertDetails, AlertPayload } from '../../../adapters'
import type { EffectiveCustomWebhookTarget } from '../../../custom-webhook-config'
import type { FindingContext } from '../finding-context'

import { loadEnvCustomWebhookTargets } from '../../../custom-webhook-env'
import { buildAlertDetails } from '../alert-details'
import { dispatchCustomWebhookTargets } from './custom-targets'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch
let bodies: string[] = []

beforeEach(() => {
  bodies = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function target(
  over: Partial<EffectiveCustomWebhookTarget> = {}
): EffectiveCustomWebhookTarget {
  return {
    id: 'cwt_test',
    name: 'test',
    url: 'https://93.184.216.34/hook',
    enabled: true,
    format: 'raw-json',
    minSeverity: null,
    titleTemplate: '',
    bodyTemplate: '',
    headers: {},
    updatedAt: 0,
    source: 'env' as EffectiveCustomWebhookTarget['source'],
    editable: false,
    ...over,
  }
}

const payload: AlertPayload = {
  severity: 'critical',
  hostLabel: 'h',
  hostId: 1,
  metric: 'rule',
  value: 1,
  title: 'T',
  label: 'L',
  timestamp: '2026-01-01T00:00:00.000Z',
}

const details: AlertDetails = {
  trend: 'rising',
  repeatCount: 2,
  firstFiredAt: '2025-12-31T23:00:00.000Z',
}

const finding = {
  hostId: 1,
  hostLabel: 'h',
  ruleId: 'rule',
  ruleTitle: 'T',
  label: 'L',
  value: 1,
  effective: 'critical',
  isRecovery: false,
  decision: { kind: 'new', notify: true, severity: 'critical' },
  text: 'x',
} as unknown as FindingContext

async function send(t: EffectiveCustomWebhookTarget): Promise<unknown> {
  await dispatchCustomWebhookTargets(finding, {
    targets: [t],
    payload,
    text: 'x',
    globalMinSeverity: 'warning',
    severity: 'critical',
    details,
  })
  return JSON.parse(bodies[0] ?? 'null')
}

// The exact body a raw target sent before `details` existed.
const LEGACY_RAW_BODY = {
  severity: 'critical',
  title: 'T',
  metric: 'rule',
  value: 1,
  thresholds: { warning: null, critical: null },
  host: { id: 1, label: 'h' },
  label: 'L',
  runbookUrls: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  text: '[CRITICAL] T — L (host h)',
}

describe('custom target details', () => {
  test('off (unset) leaves the body byte-identical', async () => {
    const body = await send(target())
    expect(body).toEqual(LEGACY_RAW_BODY)
    expect(bodies[0]).toBe(JSON.stringify(LEGACY_RAW_BODY))
  })

  test('details: false is the same as unset', async () => {
    await send(target({ details: false }))
    expect(bodies[0]).toBe(JSON.stringify(LEGACY_RAW_BODY))
  })

  test('on adds exactly trend, repeatCount and firstFiredAt', async () => {
    const body = await send(target({ details: true }))
    expect(body).toEqual({ ...LEGACY_RAW_BODY, details })
    expect(Object.keys((body as { details: object }).details)).toEqual([
      'trend',
      'repeatCount',
      'firstFiredAt',
    ])
  })

  test('on does not change a non-raw format', async () => {
    const off = await send(target({ format: 'slack' }))
    bodies = []
    const on = await send(target({ format: 'slack', details: true }))
    expect(on).toEqual(off)
  })
})

describe('buildAlertDetails', () => {
  const now = '2026-01-01T00:00:00.000Z'

  test('a new incident starts now with no trend baseline', () => {
    expect(
      buildAlertDetails({
        kind: 'new',
        value: 5,
        previousValue: undefined,
        previousState: undefined,
        now,
      })
    ).toEqual({ trend: null, repeatCount: 0, firstFiredAt: now })
  })

  test('a reminder reports trend, repeat count and the incident start', () => {
    const state = {
      severity: 'critical' as const,
      updatedAt: 0,
      notifiedAt: 0,
      firstFiredAt: Date.parse('2025-12-31T00:00:00.000Z'),
      repeatCount: 3,
    }
    const base = {
      kind: 'reminder' as const,
      previousState: state,
      now,
    }
    const rising = buildAlertDetails({ ...base, value: 9, previousValue: 5 })
    expect(rising).toEqual({
      trend: 'rising',
      repeatCount: 3,
      firstFiredAt: '2025-12-31T00:00:00.000Z',
    })
    expect(
      buildAlertDetails({ ...base, value: 2, previousValue: 5 }).trend
    ).toBe('falling')
    expect(
      buildAlertDetails({ ...base, value: 5, previousValue: 5 }).trend
    ).toBe('flat')
  })
})

describe('details option parsing', () => {
  test('HEALTH_ALERT_WEBHOOK_TARGETS carries details: true, default off', () => {
    const env = {
      HEALTH_ALERT_WEBHOOK_TARGETS: JSON.stringify([
        { name: 'a', urlEnv: 'A_URL', details: true },
        { name: 'b', urlEnv: 'B_URL' },
      ]),
      A_URL: 'https://93.184.216.34/a',
      B_URL: 'https://93.184.216.34/b',
    }
    const [a, b] = loadEnvCustomWebhookTargets(env)
    expect(a?.details).toBe(true)
    expect(b?.details).toBeUndefined()
  })
})
