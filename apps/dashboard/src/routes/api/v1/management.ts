/**
 * Management API Endpoint
 *
 * GET  /api/v1/management        → { enabled: boolean }
 * POST /api/v1/management?hostId=N → execute a DDL management operation
 *
 * Guarded by CLICKHOUSE_MANAGEMENT_ENABLED env var and ACTIONS_FEATURE_PERMISSION.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { ACTIONS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  type AlterUserOptions,
  type CreateUserOptions,
  generateAlterUserDdl,
  generateCreateUserDdl,
  generateDropUserDdl,
  generateGrantPrivilegeDdl,
  generateGrantRoleDdl,
  generateRevokePrivilegeDdl,
  generateRevokeRoleDdl,
  type PrivilegeTarget,
} from '@/lib/security/management-ddl'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManagementOperation =
  | 'create_user'
  | 'alter_user'
  | 'drop_user'
  | 'grant_role'
  | 'revoke_role'
  | 'grant_privilege'
  | 'revoke_privilege'

interface ManagementRequest {
  operation: ManagementOperation
  params: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isManagementEnabled(): boolean {
  try {
    const bindings = env as Record<string, string | undefined>
    if (bindings.CLICKHOUSE_MANAGEMENT_ENABLED === 'true') return true
  } catch {
    // cloudflare:workers env not available
  }
  return (
    typeof process !== 'undefined' &&
    process.env?.CLICKHOUSE_MANAGEMENT_ENABLED === 'true'
  )
}

function managementDisabledResponse(): Response {
  return Response.json(
    {
      success: false,
      error:
        'Management is disabled. Set CLICKHOUSE_MANAGEMENT_ENABLED=true to enable.',
    },
    { status: 403 }
  )
}

function getString(
  params: Record<string, unknown>,
  key: string
): string | undefined {
  const v = params[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function getBoolean(
  params: Record<string, unknown>,
  key: string
): boolean | undefined {
  const v = params[key]
  return typeof v === 'boolean' ? v : undefined
}

/**
 * Build a DDL string from an operation + its raw params.
 * Returns { ddl, message } on success or throws with a descriptive error string.
 */
function buildDdl(
  operation: ManagementOperation,
  params: Record<string, unknown>
): { ddl: string; message: string } {
  switch (operation) {
    case 'create_user': {
      const username = getString(params, 'username')
      if (!username) throw new Error('params.username is required')
      const opts: CreateUserOptions = { username }
      const pw = getString(params, 'password')
      if (pw) opts.password = pw
      const host = getString(params, 'host')
      if (host) opts.host = host as CreateUserOptions['host']
      const dr = getString(params, 'defaultRole')
      if (dr) opts.defaultRole = dr
      const dd = getString(params, 'defaultDatabase')
      if (dd) opts.defaultDatabase = dd
      return {
        ddl: generateCreateUserDdl(opts),
        message: `User '${username}' created successfully.`,
      }
    }

    case 'alter_user': {
      const username = getString(params, 'username')
      if (!username) throw new Error('params.username is required')
      const opts: AlterUserOptions = { username }
      const pw = getString(params, 'newPassword')
      if (pw) opts.newPassword = pw
      const dr = getString(params, 'defaultRole')
      if (dr) opts.defaultRole = dr
      const dd = getString(params, 'defaultDatabase')
      if (dd) opts.defaultDatabase = dd
      return {
        ddl: generateAlterUserDdl(opts),
        message: `User '${username}' altered successfully.`,
      }
    }

    case 'drop_user': {
      const username = getString(params, 'username')
      if (!username) throw new Error('params.username is required')
      return {
        ddl: generateDropUserDdl(username),
        message: `User '${username}' dropped successfully.`,
      }
    }

    case 'grant_role': {
      const role = getString(params, 'role')
      const toUser = getString(params, 'username')
      if (!role) throw new Error('params.role is required')
      if (!toUser) throw new Error('params.username is required')
      return {
        ddl: generateGrantRoleDdl(role, toUser),
        message: `Role '${role}' granted to '${toUser}'.`,
      }
    }

    case 'revoke_role': {
      const role = getString(params, 'role')
      const fromUser = getString(params, 'username')
      if (!role) throw new Error('params.role is required')
      if (!fromUser) throw new Error('params.username is required')
      return {
        ddl: generateRevokeRoleDdl(role, fromUser),
        message: `Role '${role}' revoked from '${fromUser}'.`,
      }
    }

    case 'grant_privilege': {
      const privilege = getString(params, 'privilege')
      const on = getString(params, 'on')
      const toUser = getString(params, 'username')
      if (!privilege) throw new Error('params.privilege is required')
      if (!on) throw new Error('params.on is required')
      if (!toUser) throw new Error('params.username is required')
      const target: PrivilegeTarget = { privilege, on }
      const wgo = getBoolean(params, 'withGrantOption')
      if (wgo !== undefined) target.withGrantOption = wgo
      return {
        ddl: generateGrantPrivilegeDdl(target, toUser),
        message: `Privilege '${privilege}' on '${on}' granted to '${toUser}'.`,
      }
    }

    case 'revoke_privilege': {
      const privilege = getString(params, 'privilege')
      const on = getString(params, 'on')
      const fromUser = getString(params, 'username')
      if (!privilege) throw new Error('params.privilege is required')
      if (!on) throw new Error('params.on is required')
      if (!fromUser) throw new Error('params.username is required')
      return {
        ddl: generateRevokePrivilegeDdl({ privilege, on }, fromUser),
        message: `Privilege '${privilege}' on '${on}' revoked from '${fromUser}'.`,
      }
    }
  }
}

const VALID_OPERATIONS = new Set<ManagementOperation>([
  'create_user',
  'alter_user',
  'drop_user',
  'grant_role',
  'revoke_role',
  'grant_privilege',
  'revoke_privilege',
])

function isValidOperation(op: unknown): op is ManagementOperation {
  return (
    typeof op === 'string' && VALID_OPERATIONS.has(op as ManagementOperation)
  )
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/v1/management')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ enabled: isManagementEnabled() })
      },

      POST: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        if (!isManagementEnabled()) {
          return managementDisabledResponse()
        }

        const permissionResponse = await authorizeFeatureRequest(
          ACTIONS_FEATURE_PERMISSION,
          request
        )
        if (permissionResponse) return permissionResponse

        // Parse hostId
        const url = new URL(request.url)
        const hostIdRaw = url.searchParams.get('hostId')
        if (hostIdRaw === null || hostIdRaw === '') {
          return Response.json(
            { success: false, error: 'Missing required parameter: hostId' },
            { status: 400 }
          )
        }
        const hostId = Number.parseInt(hostIdRaw, 10)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              error: 'Invalid parameter: hostId must be a non-negative integer',
            },
            { status: 400 }
          )
        }

        // Cloud demo-hiding invariant (#2172 / #2488): user connections
        // always use negative hostIds, so a non-negative id from a
        // signed-in cloud principal can only be the hidden env/demo host.
        // This is a mutation endpoint (DDL), so reject outright rather than
        // returning structured-empty data.
        if (
          await isDemoHostBlockedForRequest(
            hostId,
            env as Record<string, string | undefined>
          )
        ) {
          return Response.json(
            {
              success: false,
              error: 'The demo host is hidden for signed-in accounts.',
            },
            { status: 403 }
          )
        }

        // Parse body
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            { success: false, error: 'Invalid JSON body' },
            { status: 400 }
          )
        }

        const req = body as Partial<ManagementRequest>
        if (!isValidOperation(req.operation)) {
          return Response.json(
            {
              success: false,
              error: `Invalid or missing operation. Expected one of: ${[...VALID_OPERATIONS].join(', ')}`,
            },
            { status: 400 }
          )
        }
        const params: Record<string, unknown> =
          req.params && typeof req.params === 'object' ? req.params : {}

        // Build DDL server-side
        let ddl: string
        let message: string
        try {
          ;({ ddl, message } = buildDdl(req.operation, params))
        } catch (err) {
          return Response.json(
            {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 400 }
          )
        }

        // Execute
        const { error } = await fetchData({ query: ddl, hostId })
        if (error) {
          return Response.json(
            { success: false, error: error.message },
            { status: 500 }
          )
        }

        return Response.json({ success: true, ddl, message })
      },
    },
  },
})
