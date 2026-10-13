/**
 * Send-time SSRF guard for custom webhook targets (#3808). The API validates a
 * URL at save time, but DNS/config can change, so the sweep re-validates every
 * target before fetching it. These tests drive the real `validateHostUrl` with
 * IP literals (no DNS) and a stubbed `globalThis.fetch`.
 */

import type { AlertPayload } from '../../../adapters'
import type { EffectiveCustomWebhookTarget } from '../../../custom-webhook-config'
import type { FindingContext } from '../finding-context'

import { dispatchCustomWebhookTargets } from './custom-targets'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch
const savedAllowPrivate = process.env.CHM_ALLOW_PRIVATE_HOSTS
let fetched: string[] = []

beforeEach(() => {
  fetched = []
  delete process.env.CHM_ALLOW_PRIVATE_HOSTS
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (savedAllowPrivate === undefined) {
    delete process.env.CHM_ALLOW_PRIVATE_HOSTS
  } else {
    process.env.CHM_ALLOW_PRIVATE_HOSTS = savedAllowPrivate
  }
})

function target(url: string): EffectiveCustomWebhookTarget {
  return {
    id: 'cwt_test',
    name: 'test',
    url,
    enabled: true,
    format: 'raw-json',
    minSeverity: null,
    titleTemplate: '',
    bodyTemplate: '',
    headers: {},
    updatedAt: 0,
    source: 'env' as EffectiveCustomWebhookTarget['source'],
    editable: false,
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

function run(targets: EffectiveCustomWebhookTarget[]): Promise<boolean> {
  return dispatchCustomWebhookTargets(finding, {
    targets,
    payload,
    text: 'x',
    globalMinSeverity: 'warning',
    severity: 'critical',
  })
}

describe('dispatchCustomWebhookTargets send-time SSRF guard', () => {
  test('control: a public https target is fetched and reported delivered', async () => {
    expect(await run([target('https://93.184.216.34/hook')])).toBe(true)
    expect(fetched).toEqual(['https://93.184.216.34/hook'])
  })

  test('loopback target is never fetched', async () => {
    expect(await run([target('https://127.0.0.1/hook')])).toBe(false)
    expect(fetched).toEqual([])
  })

  test('cloud metadata address is never fetched', async () => {
    expect(await run([target('https://169.254.169.254/latest')])).toBe(false)
    expect(fetched).toEqual([])
  })

  test('a blocked target does not stop later valid targets', async () => {
    const ok = await run([
      target('https://10.0.0.5/hook'),
      target('https://93.184.216.34/ok'),
    ])
    expect(ok).toBe(true)
    expect(fetched).toEqual(['https://93.184.216.34/ok'])
  })

  test('plain http target is refused even for a public address', async () => {
    expect(await run([target('http://93.184.216.34/hook')])).toBe(false)
    expect(fetched).toEqual([])
  })
})
