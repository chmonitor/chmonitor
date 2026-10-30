/**
 * Delta line and shared columns for digests (#4246).
 *
 * A sweep that only adds findings of an already-open rule, or only resolves,
 * sends one short line instead of the whole table. A column whose value is the
 * same on every row is left out, because the header already says it.
 */

import type { AlertPayload } from '../types'

import { digestDeltaLine, digestDeltaOf } from '../digest'
import {
  buildGenericJsonDigestBody,
  buildSlackDigestBody,
  buildWebhookDeltaDispatchBody,
  summarizeDigest,
} from '../index'
import { describe, expect, test } from 'bun:test'

function finding(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    severity: 'warning',
    hostLabel: 'node-1',
    hostId: 1,
    metric: 'source-silent',
    value: 1,
    title: 'Source stopped sending rows',
    label: 'db.events:source-1',
    timestamp: '2026-10-30T02:20:00.000Z',
    ...over,
  }
}

const SLACK = 'https://hooks.slack.com/services/T/B/x'
const GENERIC = 'https://hooks.example.com/alerts'

describe('delta line', () => {
  test('one more warning of an open rule, one resolved', () => {
    const delta = digestDeltaOf(
      [finding(), finding({ severity: 'recovery' })],
      60
    )
    expect(digestDeltaLine(delta)).toBe('+1 warning · 1 resolved · 60 open')
  })

  test('only resolves leave out the added parts', () => {
    const delta = digestDeltaOf([finding({ severity: 'recovery' })], 59)
    expect(digestDeltaLine(delta)).toBe('1 resolved · 59 open')
  })

  test('Slack gets one text line and no attachment, not the table', () => {
    const { body } = buildWebhookDeltaDispatchBody({
      url: SLACK,
      payloads: [finding()],
      open: 60,
    })
    expect(body).toEqual({ text: '+1 warning · 60 open', attachments: [] })
  })

  test('generic JSON carries the counts and the same text', () => {
    const { body } = buildWebhookDeltaDispatchBody({
      url: GENERIC,
      payloads: [
        finding({ severity: 'critical' }),
        finding({ severity: 'recovery' }),
      ],
      open: 3,
    })
    expect(body).toEqual({
      digest: 'delta',
      added: { critical: 1, warning: 0 },
      resolved: 1,
      open: 3,
      text: '+1 critical · 1 resolved · 3 open',
    })
  })
})

describe('columns shared by every row are left out', () => {
  const two = [
    finding({ metric: 'a', title: 'Rule A', label: 'x' }),
    finding({ metric: 'b', title: 'Rule B', label: 'y' }),
  ]

  test('rows on one host do not repeat the host', () => {
    const text = buildSlackDigestBody(two).attachments[0].blocks[1].text?.text
    expect(text).not.toContain('node-1')
    expect(summarizeDigest(two).findingLines.join('\n')).not.toContain('node-1')
    expect(buildGenericJsonDigestBody(two).text).not.toContain('(host node-1)')
  })

  test('rows on several hosts keep the host', () => {
    const mixed = [two[0], { ...two[1], hostId: 2, hostLabel: 'node-2' }]
    const text = buildSlackDigestBody(mixed).attachments[0].blocks[1].text?.text
    expect(text).toContain('node-1')
    expect(text).toContain('node-2')
  })
})
