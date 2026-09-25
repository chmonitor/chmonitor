import { loadEnvCustomWebhookTargets } from './custom-webhook-env'
import { describe, expect, test } from 'bun:test'

describe('Helm custom webhook environment contract', () => {
  test('loads non-secret metadata and secret references from environment', () => {
    const targets = loadEnvCustomWebhookTargets({
      HEALTH_ALERT_WEBHOOK_TARGETS: JSON.stringify([
        {
          name: 'slack',
          format: 'slack',
          urlEnv: 'SLACK_URL',
          titleTemplate: '{{title}}',
          headers: [{ name: 'X-Source', value: 'chmonitor' }],
          headersEnv: 'SLACK_HEADERS',
        },
      ]),
      SLACK_URL: 'https://hooks.slack.com/services/T/B/secret',
      SLACK_HEADERS: '{"Authorization":"Bearer secret","X-Team":"ops"}',
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      id: 'env:slack',
      name: 'slack',
      url: 'https://hooks.slack.com/services/T/B/secret',
      format: 'slack',
      headers: { 'X-Source': 'chmonitor', 'X-Team': 'ops' },
      secretHeaders: { Authorization: 'Bearer secret' },
    })
  })

  test('skips malformed or incomplete declarations without throwing', () => {
    expect(
      loadEnvCustomWebhookTargets({
        HEALTH_ALERT_WEBHOOK_TARGETS: '{bad',
      })
    ).toEqual([])
    expect(
      loadEnvCustomWebhookTargets({
        HEALTH_ALERT_WEBHOOK_TARGETS: JSON.stringify([
          { name: 'missing-url', urlEnv: 'MISSING_URL' },
        ]),
      })
    ).toEqual([])
  })

  test('does not allow secret-bearing headers through the public parser', () => {
    const targets = loadEnvCustomWebhookTargets({
      HEALTH_ALERT_WEBHOOK_TARGETS: JSON.stringify([
        {
          name: 'unsafe',
          urlEnv: 'UNSAFE_URL',
          headers: { Authorization: 'Bearer no' },
        },
      ]),
      UNSAFE_URL: 'https://example.test/hook',
    })
    expect(targets[0]?.headers).toEqual({})
  })
})
