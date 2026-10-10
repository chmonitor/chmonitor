/**
 * The "alerts cannot be delivered" notice (#3701) must show when the sweep
 * would run dry-run or not run at all, and stay silent when delivery is armed
 * or the state is unknown.
 */

import { alertDeliveryProblem } from './alert-delivery-notice'
import { describe, expect, test } from 'bun:test'

describe('alertDeliveryProblem', () => {
  test('HEALTH_ALERT_ENABLED off means dry-run — the notice shows', () => {
    const msg = alertDeliveryProblem({
      alertingEnabled: false,
      sweepEnabled: true,
    })
    expect(msg).toContain('dry-run')
  })

  test('a disabled sweep is reported even when alerting is on', () => {
    const msg = alertDeliveryProblem({
      alertingEnabled: true,
      sweepEnabled: false,
    })
    expect(msg).toContain('sweep is off')
  })

  test('armed delivery shows nothing', () => {
    expect(
      alertDeliveryProblem({ alertingEnabled: true, sweepEnabled: true })
    ).toBeNull()
  })

  test('unknown (loading, error, older server) shows nothing', () => {
    expect(alertDeliveryProblem(null)).toBeNull()
  })
})
