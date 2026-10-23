import type { AlertPayload } from '../types'

import {
  buildOpsgenieBody,
  OPSGENIE_MESSAGE_MAX,
  opsgenieCloseNote,
} from '../opsgenie'
import { describe, expect, test } from 'bun:test'

const BASE: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 1,
  metric: 'disk-usage',
  value: 97,
  title: 'Disk almost full',
  label: 'data volume nearly full',
  timestamp: '2026-07-02T10:00:00.000Z',
}

describe('opsgenie message limit', () => {
  // Opsgenie Alert API docs, Create Alert: message "130 characters maximum".
  test('limit is 130', () => {
    expect(OPSGENIE_MESSAGE_MAX).toBe(130)
  })

  test('a short message is left alone', () => {
    expect(buildOpsgenieBody(BASE).message).toBe(
      'Disk almost full — data volume nearly full (host prod-1)'
    )
  })

  test('a long message is cut to 130 characters ending in an ellipsis', () => {
    const { message } = buildOpsgenieBody({
      ...BASE,
      label: 'x'.repeat(300),
    })
    expect(Array.from(message)).toHaveLength(130)
    expect(message.endsWith('…')).toBe(true)
    expect(message.startsWith('Disk almost full — xxx')).toBe(true)
  })

  test('a message of exactly 130 characters is not truncated', () => {
    const fixed = 'Disk almost full —  (host prod-1)'.length
    const label = 'y'.repeat(130 - fixed)
    const { message } = buildOpsgenieBody({ ...BASE, label })
    expect(message).toHaveLength(130)
    expect(message.endsWith('…')).toBe(false)
  })
})

describe('opsgenie close note', () => {
  test('carries the resolved message and how long it fired', () => {
    expect(
      opsgenieCloseNote({
        ...BASE,
        severity: 'recovery',
        firedForMs: 3 * 3_600_000,
      })
    ).toBe(
      '[RESOLVED] Disk almost full — data volume nearly full (host prod-1), fired for 3 h'
    )
  })

  test('omits the duration when unknown', () => {
    expect(opsgenieCloseNote({ ...BASE, severity: 'recovery' })).toBe(
      '[RESOLVED] Disk almost full — data volume nearly full (host prod-1)'
    )
  })
})
