/**
 * Agent host binding: which ClickHouse the agent's tools query.
 *
 * Env/demo hosts (`hostId >= 0`) go through `fetchData` as before. A signed-in
 * user's own saved connection (`hostId <= -1000`, the D1/state-backend store)
 * is resolved ONCE in the agent route — ownership-checked through the same
 * store the user-connection chart/table routes use — and bound to every tool
 * call with `AsyncLocalStorage` (see `bindToolsToConnection`).
 * `readOnlyQuery` (tools/helpers.ts) reads the binding, so the advisor /
 * insights libraries that call it reach the user's connection too.
 *
 * Why AsyncLocalStorage and not a module-level variable: requests for
 * different users run concurrently in one isolate. The binding must follow
 * each tool call's own async chain, never a shared global.
 *
 * Fail-closed rules (enforced in `helpers.ts`):
 * - a bound tool call can only target the bound host id — a model-supplied
 *   `hostId: 0` override never silently reaches the env/demo host;
 * - a negative host id with no binding throws — it never reaches `fetchData`;
 * - the connection path always runs read-only (level 2, as the env client
 *   sends it — see `readonly-settings.ts` in `@chm/clickhouse-client`).
 */

import type { DataFormat } from '@clickhouse/client'

import type {
  ConnectionCredentials,
  ConnectionStore,
} from '@/lib/connection-store/types'

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  DEFAULT_CLICKHOUSE_MAX_EXECUTION_TIME,
  QUERY_COMMENT,
} from '@chm/clickhouse-client/constants'
import { createConnectionClient } from '@/lib/connection-query/connection-client'
import { DB_CONNECTION_HOST_ID_START } from '@/lib/connection-store/types'

/** A user's own saved ClickHouse connection, resolved for one agent request. */
export interface AgentConnectionBinding {
  /** The negative host id the client sent (`<= -1000`). */
  readonly hostId: number
  readonly userId: string
  readonly connectionId: string
  readonly credentials: ConnectionCredentials
}

export type ResolveAgentConnectionResult =
  | { ok: true; binding: AgentConnectionBinding }
  | {
      ok: false
      /**
       * - `storage_disabled`: per-user connection storage is off here.
       * - `browser_connection`: a browser-stored id (-1..-999); its
       *   credentials never leave the browser, so the server cannot query it.
       * - `not_found`: no connection with that host id for THIS user
       *   (another user's id resolves here too — never disclosed).
       * - `unsupported_engine`: a Postgres connection; the agent's tools speak
       *   ClickHouse SQL.
       */
      reason:
        | 'storage_disabled'
        | 'browser_connection'
        | 'not_found'
        | 'unsupported_engine'
    }

export interface ResolveAgentConnectionDeps {
  storageEnabled: () => boolean
  loadStore: () => Promise<ConnectionStore>
}

async function defaultDeps(): Promise<ResolveAgentConnectionDeps> {
  const [{ getUserConnectionsServerConfig }, { resolveConnectionStore }] =
    await Promise.all([
      import('@/lib/connection-store/server-feature'),
      import('@/lib/connection-store/resolve-store'),
    ])
  return {
    storageEnabled: () => getUserConnectionsServerConfig().dbStorageEnabled,
    loadStore: resolveConnectionStore,
  }
}

/**
 * Resolve `hostId` (negative) to the signed-in user's own ClickHouse
 * connection. Ownership is checked by the store itself: both `list` and
 * `getCredentials` are scoped to `userId`, so a foreign id is `not_found`.
 */
export async function resolveAgentConnection(
  input: { hostId: number; userId: string },
  deps?: ResolveAgentConnectionDeps
): Promise<ResolveAgentConnectionResult> {
  const { hostId, userId } = input
  if (hostId > DB_CONNECTION_HOST_ID_START) {
    return { ok: false, reason: 'browser_connection' }
  }
  const d = deps ?? (await defaultDeps())
  if (!d.storageEnabled()) return { ok: false, reason: 'storage_disabled' }

  const store = await d.loadStore()
  const meta = (await store.list(userId)).find((c) => c.hostId === hostId)
  if (!meta || meta.userId !== userId) return { ok: false, reason: 'not_found' }
  if (meta.engine !== 'clickhouse') {
    return { ok: false, reason: 'unsupported_engine' }
  }
  const credentials = await store.getCredentials(userId, meta.id)
  if (!credentials || (credentials.kind && credentials.kind !== 'clickhouse')) {
    return { ok: false, reason: 'not_found' }
  }
  return {
    ok: true,
    binding: { hostId, userId, connectionId: meta.id, credentials },
  }
}

const bindingStorage = new AsyncLocalStorage<AgentConnectionBinding>()

/** The connection bound to the current tool call, if any. */
export function currentAgentConnection(): AgentConnectionBinding | undefined {
  return bindingStorage.getStore()
}

/** Run `fn` with `binding` as the current agent connection. */
export function runWithAgentConnection<T>(
  binding: AgentConnectionBinding,
  fn: () => T
): T {
  return bindingStorage.run(binding, fn)
}

/** Thrown when a tool call targets a host the binding does not allow. */
export class AgentHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentHostError'
  }
}

/**
 * Throw unless `hostId` is the bound connection's id. A tool's optional
 * `hostId` override is non-negative, so on a user connection any override is
 * a different (env/demo) host — refused, never silently used.
 */
export function assertBoundHost(
  binding: AgentConnectionBinding,
  hostId: number
): void {
  if (hostId !== binding.hostId) {
    throw new AgentHostError(
      `This chat is using your connection (host ${binding.hostId}); host ${hostId} is not available here. Omit hostId to query your connection.`
    )
  }
}

/** Error for a tool that cannot run against a user's own connection. */
export function unsupportedOnConnectionError(toolName: string): AgentHostError {
  return new AgentHostError(
    `The ${toolName} tool is not available on your own connections yet. Use the query tools instead.`
  )
}

/**
 * Run one read-only query on the bound connection. Mirrors `fetchData`:
 * QUERY_COMMENT prefix, the client-level `max_execution_time` default
 * (`CLICKHOUSE_MAX_EXECUTION_TIME`, else 60s) under the caller's settings, and
 * read-only mode last so no caller can turn it off. The parsed `json()` result
 * is returned as-is.
 *
 * Read-only is sent at level 2, exactly what the env client turns
 * `readonly: '1'` into: level 1 refuses the request outright when it also
 * carries `max_execution_time` (Code 164, #3680). Level 2 still refuses every
 * write, DDL and `SETTINGS readonly = 0`.
 */
/** Read-only level the env client sends; see `connectionReadOnlyQuery`. */
const READONLY_LEVEL = '2'

function maxExecutionTime(): number {
  const fromEnv = Number(process.env.CLICKHOUSE_MAX_EXECUTION_TIME)
  return Number.isInteger(fromEnv) && fromEnv > 0
    ? fromEnv
    : Number(DEFAULT_CLICKHOUSE_MAX_EXECUTION_TIME)
}

export async function connectionReadOnlyQuery(
  binding: AgentConnectionBinding,
  options: {
    query: string
    format?: DataFormat
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
  }
): Promise<unknown> {
  const client = createConnectionClient(binding.credentials)
  try {
    const result = await client.query({
      query: QUERY_COMMENT + options.query,
      format: options.format ?? 'JSONEachRow',
      query_params: options.query_params,
      clickhouse_settings: {
        max_execution_time: maxExecutionTime(),
        ...options.clickhouse_settings,
        readonly: READONLY_LEVEL,
      },
    })
    return await result.json()
  } finally {
    await client.close().catch(() => {})
  }
}

/**
 * Bind every tool's `execute` to `binding` and replace the tools listed in
 * `unsupported` with a clear error. Tool names, descriptions and schemas are
 * unchanged, so the catalog and the model see the same tool set.
 */
export function bindToolsToConnection<T extends Record<string, unknown>>(
  tools: T,
  binding: AgentConnectionBinding,
  unsupported: ReadonlySet<string>
): T {
  const out: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const execute =
      tool && typeof tool === 'object'
        ? (tool as { execute?: unknown }).execute
        : undefined
    if (typeof execute !== 'function') {
      out[name] = tool
      continue
    }
    out[name] = {
      ...(tool as object),
      execute: unsupported.has(name)
        ? async () => {
            throw unsupportedOnConnectionError(name)
          }
        : (...args: unknown[]) =>
            runWithAgentConnection(binding, () =>
              (execute as (...a: unknown[]) => unknown)(...args)
            ),
    }
  }
  return out as T
}
