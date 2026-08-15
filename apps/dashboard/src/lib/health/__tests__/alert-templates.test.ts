import { DEFAULT_ALERT_SETTINGS } from '../alert-settings-storage'
import { ALERT_TEMPLATES, applyTemplate } from '../alert-templates'
import { describe, expect, test } from 'bun:test'

const CHECKS = [
  { id: 'max-parts', defaults: { warning: 150, critical: 300 } },
  { id: 'delayed-inserts', defaults: { warning: 1, critical: 5 } },
  { id: 'disk-percent', defaults: { warning: 80, critical: 90 } },
]

const template = (id: string) => {
  const found = ALERT_TEMPLATES.find((t) => t.id === id)
  if (!found) throw new Error(`no template ${id}`)
  return found
}

describe('applyTemplate', () => {
  test('sets the severity floor and browser toggle', () => {
    const result = applyTemplate(
      template('quiet'),
      { alerts: DEFAULT_ALERT_SETTINGS, thresholds: {} },
      CHECKS
    )
    expect(result.alerts.minSeverity).toBe('critical')
    expect(result.alerts.browserNotificationsEnabled).toBe(false)
  })

  test('never overwrites channel targets', () => {
    // A template answers "when to alert", the channel cards answer "where" —
    // clobbering a configured webhook would silently break delivery.
    const alerts = {
      ...DEFAULT_ALERT_SETTINGS,
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      webhookEnabled: true,
      healthchecksUrl: 'https://hc-ping.com/uuid',
    }
    const result = applyTemplate(
      template('production'),
      { alerts, thresholds: {} },
      CHECKS
    )
    expect(result.alerts.webhookUrl).toBe(alerts.webhookUrl)
    expect(result.alerts.webhookEnabled).toBe(true)
    expect(result.alerts.healthchecksUrl).toBe(alerts.healthchecksUrl)
  })

  test('a focused template only writes the checks it lists', () => {
    const result = applyTemplate(
      template('ingestion'),
      { alerts: DEFAULT_ALERT_SETTINGS, thresholds: {} },
      CHECKS
    )
    expect(Object.keys(result.thresholds).sort()).toEqual([
      'delayed-inserts',
      'max-parts',
    ])
    // Sensitive preset (0.6) on the ingestion checks.
    expect(result.thresholds['max-parts']).toEqual({
      warning: 90,
      critical: 180,
    })
  })

  test('leaves untargeted existing overrides untouched', () => {
    const result = applyTemplate(
      template('ingestion'),
      {
        alerts: DEFAULT_ALERT_SETTINGS,
        thresholds: { 'disk-percent': { warning: 70, critical: 85 } },
      },
      CHECKS
    )
    expect(result.thresholds['disk-percent']).toEqual({
      warning: 70,
      critical: 85,
    })
  })

  test('a broad template writes every check', () => {
    const result = applyTemplate(
      template('early-warning'),
      { alerts: DEFAULT_ALERT_SETTINGS, thresholds: {} },
      CHECKS
    )
    expect(Object.keys(result.thresholds).sort()).toEqual(
      CHECKS.map((c) => c.id).sort()
    )
  })

  test('adds no keys outside the AlertSettings shape', () => {
    // `loadAlertSettings` parses with a whitelist — a template that stored its
    // own field would vanish on reload.
    const result = applyTemplate(
      template('production'),
      { alerts: DEFAULT_ALERT_SETTINGS, thresholds: {} },
      CHECKS
    )
    expect(Object.keys(result.alerts).sort()).toEqual(
      Object.keys(DEFAULT_ALERT_SETTINGS).sort()
    )
  })
})
