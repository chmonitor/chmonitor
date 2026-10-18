/**
 * Hookshot / Matrix digest bodies (#3869). One sweep that produces N findings
 * for one Hookshot or Matrix target sends ONE grouped message; these pin what
 * that message must carry: escaped operator text (a rule title or host label
 * must never inject markup into a Matrix room), a severity colour, the line
 * cap, and exactly one dashboard link.
 */

import type { AlertPayload } from '../types'

import {
  buildCustomTargetDigestBody,
  MAX_CUSTOM_WEBHOOK_BODY_BYTES,
} from '../../custom-webhook-targets'
import { MAX_DIGEST_LINES } from '../digest'
import { buildHookshotBody, buildHookshotDigestBody } from '../hookshot'
import { buildMatrixBody, buildMatrixDigestBody } from '../matrix'
import { describe, expect, test } from 'bun:test'

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    severity: 'critical',
    hostLabel: 'db-1',
    hostId: 0,
    metric: 'disk-usage',
    value: 95,
    title: 'Disk usage',
    label: '95% used',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('buildHookshotDigestBody', () => {
  test('escapes every operator-controlled string in html', () => {
    const body = buildHookshotDigestBody([
      payload({
        title: '<img src=x onerror=1>',
        label: '<script>a</script>',
        hostLabel: '<b>evil</b>',
        instanceName: '<i>prod</i>',
      }),
      payload({ hostId: 1, metric: '"m"&<x>' }),
    ])
    expect(body.html).not.toContain('<img')
    expect(body.html).not.toContain('<script>')
    expect(body.html).not.toContain('<b>evil')
    expect(body.html).not.toContain('<i>prod')
    expect(body.html).not.toContain('<x>')
    expect(body.html).toContain('&lt;img src=x onerror=1&gt;')
    expect(body.html).toContain('&lt;script&gt;a&lt;/script&gt;')
    expect(body.html).toContain('&lt;b&gt;evil&lt;/b&gt;')
    expect(body.html).toContain('[&lt;i&gt;prod&lt;/i&gt;]')
    expect(body.username).toBe('<i>prod</i>')
  })

  test('colours the header by the top severity', () => {
    const critical = buildHookshotDigestBody([
      payload({ severity: 'warning' }),
      payload({ severity: 'critical', hostId: 1 }),
    ])
    expect(critical.html.startsWith('<b><font data-mx-color="#dd3333">')).toBe(
      true
    )
    const recovery = buildHookshotDigestBody([
      payload({ severity: 'recovery' }),
      payload({ severity: 'recovery', hostId: 1 }),
    ])
    expect(recovery.html.startsWith('<b><font data-mx-color="#2e9e44">')).toBe(
      true
    )
    expect(recovery.text).toContain('2 recovery on 2 hosts')
  })

  test('groups findings by rule, recoveries included', () => {
    const body = buildHookshotDigestBody([
      payload({ title: 'Disk usage', hostLabel: 'a' }),
      payload({ title: 'Replica lag', hostLabel: 'b', hostId: 1 }),
      payload({
        title: 'Disk usage',
        hostLabel: 'c',
        hostId: 2,
        severity: 'recovery',
      }),
    ])
    expect(count(body.html, '<b>Disk usage</b>')).toBe(1)
    expect(count(body.html, '<b>Replica lag</b>')).toBe(1)
    expect(count(body.html, '<li>')).toBe(3)
    // The recovered host is listed under its rule, not as a separate group.
    const disk = body.html.slice(
      body.html.indexOf('<b>Disk usage</b>'),
      body.html.indexOf('<b>Replica lag</b>')
    )
    expect(disk).toContain('c · disk-usage = 95')
    expect(disk).toContain('RECOVERY')
    expect(body.text).toContain('Disk usage\n- ')
  })

  test('caps rendered lines and reports the overflow', () => {
    const many = Array.from({ length: MAX_DIGEST_LINES + 1 }, (_, i) =>
      payload({ hostId: i, hostLabel: `h${i}` })
    )
    const body = buildHookshotDigestBody(many)
    expect(count(body.html, '<li>')).toBe(MAX_DIGEST_LINES)
    expect(body.html).toContain('…and 1 more')
    expect(body.text).toContain('…and 1 more')
  })

  test('links the dashboard exactly once', () => {
    const body = buildHookshotDigestBody([
      payload({ dashboardUrl: 'https://chm.example.com/health?host=0' }),
      payload({
        hostId: 1,
        dashboardUrl: 'https://chm.example.com/health?host=1',
      }),
    ])
    expect(count(body.html, '<a href=')).toBe(1)
    expect(count(body.text, 'https://chm.example.com')).toBe(1)
    // Several hosts: the link drops the per-host param.
    expect(body.html).toContain('href="https://chm.example.com/health"')
  })

  test('a single-host digest keeps the host link', () => {
    const url = 'https://chm.example.com/health?host=3'
    const body = buildHookshotDigestBody([
      payload({ hostId: 3, dashboardUrl: url }),
      payload({ hostId: 3, metric: 'other', dashboardUrl: url }),
    ])
    expect(body.text.endsWith(url)).toBe(true)
  })
})

describe('buildMatrixDigestBody', () => {
  test('shares the renderer as an m.notice', () => {
    const payloads = [payload(), payload({ hostId: 1, title: '<x>' })]
    const matrix = buildMatrixDigestBody(payloads)
    const hookshot = buildHookshotDigestBody(payloads)
    expect(matrix.msgtype).toBe('m.notice')
    expect(matrix.format).toBe('org.matrix.custom.html')
    expect(matrix.formatted_body).toBe(hookshot.html)
    expect(matrix.body).toBe(hookshot.text)
    expect(matrix.formatted_body).not.toContain('<x>')
  })
})

describe('single-finding bodies', () => {
  test('hookshot title carries the severity colour and stays escaped', () => {
    const body = buildHookshotBody(
      payload({ severity: 'warning', title: '<t>' })
    )
    expect(body.html).toContain('<font data-mx-color="#ff8c00">')
    expect(body.html).toContain('&lt;t&gt;')
    expect(body.html).not.toContain('<t>')
  })

  test('matrix title carries the severity colour', () => {
    const body = buildMatrixBody(payload({ severity: 'recovery' }))
    expect(body.formatted_body).toContain('<font data-mx-color="#2e9e44">')
  })
})
describe('buildCustomTargetDigestBody byte cap', () => {
  test('an oversize digest is truncated under the cap', () => {
    const huge = 'x'.repeat(40_000)
    for (const format of ['hookshot', 'matrix'] as const) {
      const result = buildCustomTargetDigestBody(format, [
        payload({ label: huge }),
        payload({ hostId: 1, label: huge }),
      ])
      expect(result.truncated).toBe(true)
      expect(result.adapterId).toBe(format)
      expect(
        new TextEncoder().encode(JSON.stringify(result.body)).byteLength
      ).toBeLessThanOrEqual(MAX_CUSTOM_WEBHOOK_BODY_BYTES)
    }
  })

  test('a normal digest is untouched', () => {
    const payloads = [payload(), payload({ hostId: 1 })]
    const result = buildCustomTargetDigestBody('hookshot', payloads)
    expect(result.truncated).toBe(false)
    expect(result.body).toEqual(buildHookshotDigestBody(payloads))
  })
})
