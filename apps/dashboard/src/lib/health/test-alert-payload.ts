/**
 * Synthetic "Send test" alert payload, carrying the same deployment identity
 * (instance name, dashboard link, metadata) a real sweep alert would, so a test
 * message previews exactly what operators will receive.
 */

import type { AlertPayload } from './adapters/types'

import {
  buildHealthDeepLink,
  getServerAlertIdentity,
} from './server-alert-config'

export function buildTestAlertPayload(
  overrides: Partial<AlertPayload> = {}
): AlertPayload {
  const identity = getServerAlertIdentity()
  const dashboardUrl = buildHealthDeepLink(identity.dashboardBaseUrl, 0)
  return {
    severity: 'warning',
    hostLabel: 'test-host',
    hostId: 0,
    metric: 'test',
    value: 0,
    warnThreshold: null,
    critThreshold: null,
    title: 'Test Alert',
    label: 'This is a test alert from chmonitor',
    timestamp: new Date().toISOString(),
    ...(identity.instanceName ? { instanceName: identity.instanceName } : {}),
    ...(dashboardUrl ? { dashboardUrl } : {}),
    ...(identity.metadata ? { metadata: identity.metadata } : {}),
    ...overrides,
  }
}
