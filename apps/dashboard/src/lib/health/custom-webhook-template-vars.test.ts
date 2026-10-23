import type { AlertPayload } from './adapters'

import { renderCustomTemplate } from './custom-webhook-targets'
import { describe, expect, test } from 'bun:test'

const HOUR = 3_600_000

const FIRING: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'disk-usage',
  value: 97,
  warnThreshold: 70,
  critThreshold: 90,
  title: 'Disk almost full',
  label: 'data volume',
  runbookUrls: ['https://runbooks.example.com/a', 'https://example.com/b'],
  timestamp: '2026-07-02T10:00:00.000Z',
}

const render = (template: string, payload: AlertPayload) =>
  renderCustomTemplate(template, payload, 500)

describe('custom webhook template variables for alert facts', () => {
  test('thresholds and the first runbook render', () => {
    expect(render('{{warn}}/{{crit}}/{{thresholds}}/{{runbook}}', FIRING)).toBe(
      '70/90/warn 70 | crit 90/https://runbooks.example.com/a'
    )
  })

  test('facts that do not apply render empty, not as the raw name', () => {
    const bare: AlertPayload = {
      ...FIRING,
      warnThreshold: null,
      critThreshold: undefined,
      runbookUrls: undefined,
    }
    expect(
      render(
        '[{{warn}}][{{crit}}][{{thresholds}}][{{runbook}}][{{status}}][{{stillOpen}}][{{previousValue}}][{{firedFor}}][{{firstFired}}]',
        bare
      )
    ).toBe('[][][][][][][][][]')
  })

  test('a reminder shows how long it is open and the previous value', () => {
    const reminder = { ...FIRING, stillOpenMs: 3 * HOUR, previousValue: 88 }
    expect(render('{{stillOpen}}|{{previousValue}}|{{status}}', reminder)).toBe(
      '3 h|88|still open, 3 h (88 -> 97)'
    )
  })

  test('a recovery shows how long it fired', () => {
    const recovery: AlertPayload = {
      ...FIRING,
      severity: 'recovery',
      firedForMs: 2 * HOUR,
    }
    expect(render('{{severity}} {{firedFor}} / {{status}}', recovery)).toBe(
      'RESOLVED 2 h / fired for 2 h'
    )
  })

  test('firstFired comes from the opt-in details', () => {
    const withDetails: AlertPayload = {
      ...FIRING,
      details: {
        trend: null,
        repeatCount: 0,
        firstFiredAt: '2026-07-02T07:00:00.000Z',
      },
    }
    expect(render('{{firstFired}}', withDetails)).toBe(
      '2026-07-02T07:00:00.000Z'
    )
  })
})
