/**
 * Tests for the GitHub deploy webhook route
 * (plans/45-github-deploy-correlation.md §Done criteria):
 *  - a correctly-signed `deployment` event is accepted (202) and stored.
 *  - a missing/tampered signature is rejected 401 (not 403 — this route's
 *    plan explicitly calls out 401, unlike the Polar webhook's 403).
 *  - a redelivered `deployment.id` upserts (dedupes) rather than duplicating.
 *  - unhandled event types are acknowledged 204 without storing anything.
 *
 * `@/lib/deployments/config` and `@/lib/deployments/d1-store` are mocked
 * (the D1 binding isn't available outside a Worker); signature verification
 * and event parsing run for real via the actual lib/deployments modules, so
 * this test exercises the real HMAC compare, not a mock of it.
 * `@tanstack/react-router`'s `createFileRoute` is left un-mocked, matching
 * the polar.test.ts / health/webhook.test.ts convention.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

let getGithubWebhookSecret = mock((): string | undefined => 'test_secret')
mock.module('@/lib/deployments/config', () => ({
  DEFAULT_DEPLOYMENT_SCOPE: 'default',
  getGithubWebhookSecret: () => getGithubWebhookSecret(),
}))

let upsertDeployment = mock(async (_record: unknown) => true)
mock.module('@/lib/deployments/d1-store', () => ({
  upsertDeployment: (record: unknown) => upsertDeployment(record),
}))

const { __handlePostForTests: handlePost } = await import('./github')
const { computeGithubSignature } = await import(
  '@/lib/deployments/verify-signature'
)

const SECRET = 'test_secret'

function deploymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    deployment: {
      id: 123,
      sha: 'abc1234def',
      ref: 'main',
      environment: 'production',
      created_at: '2026-07-01T12:00:00Z',
      payload: { version: 'v1.2.3' },
    },
    repository: { full_name: 'chmonitor/chmonitor' },
    ...overrides,
  }
}

async function makeSignedRequest(
  body: Record<string, unknown>,
  {
    secret = SECRET,
    event = 'deployment',
    tamperSignature = false,
  }: { secret?: string; event?: string; tamperSignature?: boolean } = {}
): Promise<Request> {
  const rawBody = JSON.stringify(body)
  const signature = await computeGithubSignature(secret, rawBody)
  return new Request('https://dash.example.com/api/v1/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': tamperSignature ? `${signature}0` : signature,
    },
    body: rawBody,
  })
}

beforeEach(() => {
  getGithubWebhookSecret = mock(() => 'test_secret')
  upsertDeployment = mock(async () => true)
})

describe('POST /api/v1/webhooks/github — signature verification', () => {
  test('a correctly-signed deployment event is accepted and stored', async () => {
    const req = await makeSignedRequest(deploymentPayload())
    const res = await handlePost(req)

    expect(res.status).toBe(202)
    expect(upsertDeployment).toHaveBeenCalledTimes(1)
    expect(upsertDeployment.mock.calls[0]?.[0]).toMatchObject({
      id: '123',
      repo: 'chmonitor/chmonitor',
      environment: 'production',
      version: 'v1.2.3',
    })
  })

  test('a tampered signature is rejected 401 and nothing is stored', async () => {
    const req = await makeSignedRequest(deploymentPayload(), {
      tamperSignature: true,
    })
    const res = await handlePost(req)

    expect(res.status).toBe(401)
    expect(upsertDeployment).not.toHaveBeenCalled()
  })

  test('a missing signature header is rejected 401', async () => {
    const rawBody = JSON.stringify(deploymentPayload())
    const req = new Request('https://dash.example.com/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'deployment',
      },
      body: rawBody,
    })
    const res = await handlePost(req)

    expect(res.status).toBe(401)
    expect(upsertDeployment).not.toHaveBeenCalled()
  })

  test('a signature computed with the wrong secret is rejected 401', async () => {
    const req = await makeSignedRequest(deploymentPayload(), {
      secret: 'wrong_secret',
    })
    const res = await handlePost(req)

    expect(res.status).toBe(401)
    expect(upsertDeployment).not.toHaveBeenCalled()
  })

  test('no configured secret returns 501 without touching the signature at all', async () => {
    getGithubWebhookSecret = mock(() => undefined)
    const req = await makeSignedRequest(deploymentPayload())
    const res = await handlePost(req)

    expect(res.status).toBe(501)
    expect(upsertDeployment).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/webhooks/github — idempotency', () => {
  test('the same deployment.id delivered twice upserts (dedupes), not duplicates', async () => {
    const req1 = await makeSignedRequest(deploymentPayload())
    const req2 = await makeSignedRequest(deploymentPayload())

    await handlePost(req1)
    await handlePost(req2)

    expect(upsertDeployment).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = upsertDeployment.mock.calls
    expect((firstCall?.[0] as { id: string }).id).toBe('123')
    expect((secondCall?.[0] as { id: string }).id).toBe('123')
    // Both calls hit the same upsert (ON CONFLICT DO UPDATE) path — the
    // dedupe key is asserted at the store level in d1-store.test.ts; this
    // test asserts the route always routes redeliveries through upsert
    // (never a plain insert) by id.
  })
})

describe('POST /api/v1/webhooks/github — event filtering', () => {
  test('an unhandled event type is acknowledged 204 without storing', async () => {
    const req = await makeSignedRequest(deploymentPayload(), {
      event: 'deployment_review',
    })
    const res = await handlePost(req)

    expect(res.status).toBe(204)
    expect(upsertDeployment).not.toHaveBeenCalled()
  })

  test('deployment_status is handled the same as deployment', async () => {
    const req = await makeSignedRequest(deploymentPayload(), {
      event: 'deployment_status',
    })
    const res = await handlePost(req)

    expect(res.status).toBe(202)
    expect(upsertDeployment).toHaveBeenCalledTimes(1)
  })
})
