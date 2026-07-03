/**
 * Unit tests for normalize.ts — the WHY under test: Alertmanager, Datadog, and
 * generic webhook payloads must all reduce to the same NormalizedEvent schema
 * (so the store/UI never special-case the source), and two occurrences of the
 * same underlying alert must collapse to the same dedup_hash (so
 * upsertEvent bumps count/last_seen instead of inserting a duplicate row).
 * Also asserts the normalizer never throws on malformed/unexpected input,
 * since payloads are external and untrusted.
 */

import { computeDedupHash, detectSource, normalizeEvent } from './normalize'
import { describe, expect, test } from 'bun:test'

const alertmanagerPayload = {
  status: 'firing',
  receiver: 'chmonitor',
  groupLabels: { alertname: 'HighCpu' },
  commonLabels: {
    alertname: 'HighCpu',
    instance: 'ch-node-1:9363',
    severity: 'critical',
  },
  commonAnnotations: {
    summary: 'CPU usage above 90% for 10m',
    description: 'Node ch-node-1 is at 96% CPU',
  },
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'HighCpu',
        instance: 'ch-node-1:9363',
        severity: 'critical',
      },
      annotations: { summary: 'CPU usage above 90% for 10m' },
      startsAt: '2026-07-01T00:00:00Z',
      fingerprint: 'abc123',
    },
  ],
}

const datadogPayload = {
  id: '12345',
  title: '[Triggered] Disk usage high',
  text: 'Disk usage on ch-node-2 is above 85%',
  alert_type: 'error',
  aggreg_key: 'disk-usage-ch-node-2',
  hostname: 'ch-node-2',
  tags: 'env:prod,service:clickhouse',
}

const genericPayload = {
  title: 'Custom check failed',
  message: 'Replication lag exceeded threshold',
  severity: 'warning',
  resource: 'ch-node-3',
  labels: { team: 'data-platform' },
}

describe('detectSource', () => {
  test('detects alertmanager by alerts[] + commonLabels', () => {
    expect(detectSource(alertmanagerPayload)).toBe('alertmanager')
  })

  test('detects datadog by alert_type + aggreg_key', () => {
    expect(detectSource(datadogPayload)).toBe('datadog')
  })

  test('falls back to generic for anything else', () => {
    expect(detectSource(genericPayload)).toBe('generic')
    expect(detectSource({})).toBe('generic')
    expect(detectSource(null)).toBe('generic')
    expect(detectSource('not an object')).toBe('generic')
    expect(detectSource([1, 2, 3])).toBe('generic')
  })
})

describe('normalizeEvent — Alertmanager', () => {
  test('normalizes to the common schema', async () => {
    const event = await normalizeEvent(alertmanagerPayload, 1000)
    expect(event.source).toBe('alertmanager')
    expect(event.severity).toBe('critical')
    expect(event.resource).toBe('ch-node-1:9363')
    expect(event.title).toBe('HighCpu')
    expect(event.body).toBe('Node ch-node-1 is at 96% CPU')
    expect(event.labels.alertname).toBe('HighCpu')
    expect(event.receivedAt).toBe(1000)
    expect(typeof event.id).toBe('string')
    expect(event.dedupHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a "resolved" status normalizes to info severity regardless of label severity', async () => {
    const resolved = {
      ...alertmanagerPayload,
      status: 'resolved',
      alerts: [{ ...alertmanagerPayload.alerts[0], status: 'resolved' }],
    }
    const event = await normalizeEvent(resolved)
    expect(event.severity).toBe('info')
  })
})

describe('normalizeEvent — Datadog', () => {
  test('normalizes to the common schema', async () => {
    const event = await normalizeEvent(datadogPayload, 2000)
    expect(event.source).toBe('datadog')
    expect(event.severity).toBe('critical') // alert_type: 'error'
    expect(event.resource).toBe('ch-node-2')
    expect(event.title).toBe('[Triggered] Disk usage high')
    expect(event.body).toBe('Disk usage on ch-node-2 is above 85%')
    expect(event.labels.env).toBe('prod')
    expect(event.labels.service).toBe('clickhouse')
    expect(event.receivedAt).toBe(2000)
  })

  test('maps datadog alert_type to the common severity scale', async () => {
    const warn = await normalizeEvent({
      ...datadogPayload,
      alert_type: 'warning',
    })
    expect(warn.severity).toBe('warning')
    const info = await normalizeEvent({
      ...datadogPayload,
      alert_type: 'success',
    })
    expect(info.severity).toBe('info')
  })
})

describe('normalizeEvent — generic', () => {
  test('normalizes to the common schema', async () => {
    const event = await normalizeEvent(genericPayload, 3000)
    expect(event.source).toBe('generic')
    expect(event.severity).toBe('warning')
    expect(event.resource).toBe('ch-node-3')
    expect(event.title).toBe('Custom check failed')
    expect(event.body).toBe('Replication lag exceeded threshold')
    expect(event.labels.team).toBe('data-platform')
    expect(event.receivedAt).toBe(3000)
  })

  test('unrecognized severity strings default to warning, not critical', async () => {
    const event = await normalizeEvent({ ...genericPayload, severity: 'weird' })
    expect(event.severity).toBe('warning')
  })

  test('never throws on malformed/unexpected input', async () => {
    await expect(normalizeEvent(null)).resolves.toBeDefined()
    await expect(normalizeEvent(undefined)).resolves.toBeDefined()
    await expect(normalizeEvent('a string')).resolves.toBeDefined()
    await expect(normalizeEvent(42)).resolves.toBeDefined()
    await expect(normalizeEvent([1, 2, 3])).resolves.toBeDefined()
    await expect(normalizeEvent({})).resolves.toBeDefined()
  })
})

describe('computeDedupHash', () => {
  test('two identical payloads produce the same dedup_hash', async () => {
    const first = await normalizeEvent(alertmanagerPayload, 1000)
    const second = await normalizeEvent(alertmanagerPayload, 5000)
    // Different receivedAt (occurrence time), same dedup identity.
    expect(second.dedupHash).toBe(first.dedupHash)
    expect(second.id).not.toBe(first.id)
  })

  test('a different severity produces a different dedup_hash (new escalation row)', async () => {
    const critical = await normalizeEvent(alertmanagerPayload)
    const warning = await normalizeEvent({
      ...alertmanagerPayload,
      commonLabels: {
        ...alertmanagerPayload.commonLabels,
        severity: 'warning',
      },
    })
    expect(warning.dedupHash).not.toBe(critical.dedupHash)
  })

  test('is a pure function of (source, resource, title, severity)', async () => {
    const a = await computeDedupHash({
      source: 'generic',
      resource: 'host-1',
      title: 'Test',
      severity: 'warning',
    })
    const b = await computeDedupHash({
      source: 'generic',
      resource: 'host-1',
      title: 'Test',
      severity: 'warning',
    })
    expect(a).toBe(b)
  })
})
