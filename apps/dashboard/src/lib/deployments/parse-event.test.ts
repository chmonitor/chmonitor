import { parseGithubDeploymentEvent } from './parse-event'
import { describe, expect, test } from 'bun:test'

function baseDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    sha: 'abc123',
    ref: 'main',
    environment: 'production',
    created_at: '2026-07-01T12:00:00Z',
    payload: { version: 'v1.2.3' },
    ...overrides,
  }
}

describe('parseGithubDeploymentEvent', () => {
  test('extracts repo/environment/ref/sha/version/createdAt from a deployment event', () => {
    const result = parseGithubDeploymentEvent({
      deployment: baseDeployment(),
      repository: { full_name: 'chmonitor/chmonitor' },
    })

    expect(result).toEqual({
      id: '42',
      repo: 'chmonitor/chmonitor',
      environment: 'production',
      ref: 'main',
      sha: 'abc123',
      version: 'v1.2.3',
      createdAtMs: Date.parse('2026-07-01T12:00:00Z'),
    })
  })

  test('a deployment_status payload (same top-level `deployment` shape) parses identically', () => {
    const result = parseGithubDeploymentEvent({
      action: 'created',
      deployment_status: { id: 999, state: 'success' },
      deployment: baseDeployment(),
      repository: { full_name: 'chmonitor/chmonitor' },
    })

    expect(result?.id).toBe('42')
  })

  test('falls back to null version when the deployment payload has none', () => {
    const result = parseGithubDeploymentEvent({
      deployment: baseDeployment({ payload: {} }),
      repository: { full_name: 'chmonitor/chmonitor' },
    })

    expect(result?.version).toBeNull()
  })

  test('parses a stringified deployment payload', () => {
    const result = parseGithubDeploymentEvent({
      deployment: baseDeployment({
        payload: JSON.stringify({ version: 'v9' }),
      }),
      repository: { full_name: 'chmonitor/chmonitor' },
    })

    expect(result?.version).toBe('v9')
  })

  test('returns null for a malformed payload (missing deployment or repository)', () => {
    expect(parseGithubDeploymentEvent({})).toBeNull()
    expect(parseGithubDeploymentEvent(null)).toBeNull()
    expect(parseGithubDeploymentEvent('not-an-object')).toBeNull()
    expect(
      parseGithubDeploymentEvent({ deployment: baseDeployment() }) // no repository
    ).toBeNull()
    expect(
      parseGithubDeploymentEvent({
        repository: { full_name: 'chmonitor/chmonitor' },
      }) // no deployment
    ).toBeNull()
  })

  test('returns null when created_at is unparseable', () => {
    const result = parseGithubDeploymentEvent({
      deployment: baseDeployment({ created_at: 'not-a-date' }),
      repository: { full_name: 'chmonitor/chmonitor' },
    })

    expect(result).toBeNull()
  })
})
