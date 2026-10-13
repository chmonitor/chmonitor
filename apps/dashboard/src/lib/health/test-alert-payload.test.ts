import { buildTestAlertPayload } from './test-alert-payload'
import { afterEach, describe, expect, test } from 'bun:test'

const KEYS = [
  'HEALTH_ALERT_INSTANCE_NAME',
  'HEALTH_ALERT_DASHBOARD_URL',
  'HEALTH_ALERT_METADATA',
] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('buildTestAlertPayload', () => {
  test('carries the server deployment identity', () => {
    process.env.HEALTH_ALERT_INSTANCE_NAME = 'prod-eu'
    process.env.HEALTH_ALERT_DASHBOARD_URL = 'https://dash.example.com'
    process.env.HEALTH_ALERT_METADATA = 'team=db'
    const p = buildTestAlertPayload()
    expect(p.instanceName).toBe('prod-eu')
    expect(p.dashboardUrl).toBe('https://dash.example.com/health?host=0')
    expect(p.metadata).toEqual({ team: 'db' })
  })

  test('has no identity keys when env is unset', () => {
    for (const k of KEYS) delete process.env[k]
    const p = buildTestAlertPayload()
    expect('instanceName' in p).toBe(false)
    expect('dashboardUrl' in p).toBe(false)
    expect('metadata' in p).toBe(false)
  })
})
