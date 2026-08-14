/**
 * Tests for resolveProxyCredentials (#2951).
 *
 * The browser-connections proxy/charts/tables routes all resolve credentials
 * through this shared helper. Without a sessionToken, it used to fall back to
 * raw `connection.{host,user,password}` from the request body unconditionally
 * — on Cloud (public, anonymous reads) that let an unauthenticated caller use
 * the deployment as a ClickHouse credential-spraying relay from the operator's
 * egress IP. The fix: in cloud mode, a sessionToken is required; the raw
 * inline-connection path stays available for self-hosted deployments only.
 */

import {
  resolveProxyCredentials,
  toSessionPayload,
} from './resolve-credentials'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createConnectionSession } from '@/lib/connection-sessions/store'

const RAW_CONNECTION = {
  host: 'https://attacker-target.example.com:8443',
  user: 'default',
  password: 'guess-me',
}

describe('resolveProxyCredentials', () => {
  const ORIGINAL_CLOUD_MODE = process.env.CHM_CLOUD_MODE
  const ORIGINAL_DEPLOYMENT_MODE = process.env.CHM_DEPLOYMENT_MODE
  const ORIGINAL_ENCRYPTION_KEY =
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY

  beforeEach(() => {
    delete process.env.CHM_CLOUD_MODE
    delete process.env.CHM_DEPLOYMENT_MODE
    // 32 zero bytes, base64 — createConnectionSession encrypts its payload
    // via the same connection-store crypto used for user connections.
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  })

  afterEach(() => {
    if (ORIGINAL_CLOUD_MODE === undefined) {
      delete process.env.CHM_CLOUD_MODE
    } else {
      process.env.CHM_CLOUD_MODE = ORIGINAL_CLOUD_MODE
    }
    if (ORIGINAL_DEPLOYMENT_MODE === undefined) {
      delete process.env.CHM_DEPLOYMENT_MODE
    } else {
      process.env.CHM_DEPLOYMENT_MODE = ORIGINAL_DEPLOYMENT_MODE
    }
    if (ORIGINAL_ENCRYPTION_KEY === undefined) {
      delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
    } else {
      process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
    }
  })

  describe('cloud mode (CHM_CLOUD_MODE=true) — the reported vulnerability', () => {
    beforeEach(() => {
      process.env.CHM_CLOUD_MODE = 'true'
    })

    test('rejects raw connection creds without a sessionToken', async () => {
      const result = await resolveProxyCredentials(
        { connection: RAW_CONNECTION },
        null
      )
      expect(result).toBeNull()
    })

    test('rejects raw connection creds even with a userId present', async () => {
      const result = await resolveProxyCredentials(
        { connection: RAW_CONNECTION },
        'user_123'
      )
      expect(result).toBeNull()
    })

    test('still resolves credentials via a valid sessionToken', async () => {
      const credentials = {
        host: 'https://legit-host.example.com:8443',
        user: 'default',
        password: 'secret',
      }
      const session = await createConnectionSession(
        toSessionPayload(credentials),
        null
      )

      const result = await resolveProxyCredentials(
        { sessionToken: session.token },
        null
      )
      expect(result).toEqual(credentials)
    })

    test('an invalid sessionToken does not fall back to raw creds', async () => {
      const result = await resolveProxyCredentials(
        { connection: RAW_CONNECTION, sessionToken: 'not-a-real-token' },
        null
      )
      expect(result).toBeNull()
    })

    test('missing both connection and sessionToken returns null', async () => {
      const result = await resolveProxyCredentials({}, null)
      expect(result).toBeNull()
    })
  })

  describe('self-hosted mode (CHM_CLOUD_MODE unset) — must keep working', () => {
    test('still resolves raw connection creds without a sessionToken', async () => {
      const result = await resolveProxyCredentials(
        { connection: RAW_CONNECTION },
        null
      )
      expect(result).toEqual(RAW_CONNECTION)
    })

    test('still resolves credentials via a valid sessionToken', async () => {
      const credentials = {
        host: 'https://legit-host.example.com:8443',
        user: 'default',
        password: 'secret',
      }
      const session = await createConnectionSession(
        toSessionPayload(credentials),
        null
      )

      const result = await resolveProxyCredentials(
        { sessionToken: session.token },
        null
      )
      expect(result).toEqual(credentials)
    })

    test('missing connection.host returns null', async () => {
      const result = await resolveProxyCredentials(
        { connection: { host: '', user: 'default', password: 'x' } },
        null
      )
      expect(result).toBeNull()
    })

    test('missing connection.user returns null', async () => {
      const result = await resolveProxyCredentials(
        {
          connection: {
            host: 'https://x.example.com',
            user: '',
            password: 'x',
          },
        },
        null
      )
      expect(result).toBeNull()
    })
  })
})
