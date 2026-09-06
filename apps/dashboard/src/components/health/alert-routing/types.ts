/** Shared test payload for route "Send test" actions. */
export const TEST_ALERT = {
  checkId: 'test',
  title: 'Test Alert',
  severity: 'warning' as const,
  value: 0,
  label: 'This is a test alert from chmonitor',
  hostId: 0,
}
