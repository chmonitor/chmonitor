import type { ConnectionCredentials } from '@/lib/connection-store/types'

import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { resolveConnectionSession } from '@/lib/connection-sessions/store'
import {
  type ConnectionSessionPayload,
  connectionFingerprint,
} from '@/lib/connection-sessions/types'

export interface ProxyConnectionInput {
  connection?: {
    host: string
    user: string
    password: string
  }
  sessionToken?: string
}

export async function resolveProxyCredentials(
  input: ProxyConnectionInput,
  userId?: string | null
): Promise<ConnectionCredentials | null> {
  if (input.sessionToken) {
    const session = await resolveConnectionSession(
      input.sessionToken,
      undefined,
      userId
    )
    return session?.credentials ?? null
  }

  // SECURITY (#2951): these proxy routes have no per-route auth (the request
  // middleware defers to it — see proxy.ts's header comment — and there is no
  // authorizeFeatureRequest() call here), so this inline-credential path was
  // reachable by any anonymous caller. Without a sessionToken, honoring
  // `connection.{host,user,password}` from the request body let an
  // unauthenticated caller use this deployment as a ClickHouse
  // credential-spraying relay from the operator's egress IP — only SSRF host
  // validation stood in the way. In cloud mode (anonymous reads are public,
  // `CHM_CLERK_PUBLIC_READ=true`) a sessionToken minted via the explicit
  // test-connection/session flow (`/browser-connections/sessions`, which
  // validates the connection before issuing a token) is now required.
  //
  // Self-hosted deployments keep the inline path: `/browser-connections/
  // sessions` 503s unless encryption is configured (`CHM_USER_CONNECTIONS_
  // ENCRYPTION_KEY` or a Clerk secret — see `isEncryptionConfigured()`), which
  // the OSS default (`CHM_AUTH_PROVIDER=none`) does not set. Requiring a
  // sessionToken unconditionally would make it impossible to mint one and
  // break the browser-connections feature outright on a typical self-hosted
  // install.
  if (isCloudModeServer()) {
    return null
  }

  if (input.connection?.host && input.connection.user) {
    const password =
      typeof input.connection.password === 'string'
        ? input.connection.password
        : ''
    return {
      host: input.connection.host,
      user: input.connection.user,
      password,
    }
  }

  return null
}

export function toSessionPayload(
  credentials: ConnectionCredentials
): ConnectionSessionPayload {
  return {
    credentials,
    fingerprint: connectionFingerprint(credentials),
  }
}
