/**
 * Per-request attribution scope (issue #4164).
 *
 * The ClickHouse client is pooled per host and shared by concurrent requests,
 * so the principal cannot live on the client. The request middleware opens a
 * scope with `AsyncLocalStorage`; entry points narrow it (a chart name, a cron
 * job), and `withQueryAttribution` reads it on every `query()` / `command()`.
 *
 * Server-only: this module imports `node:async_hooks`, so it must stay out of
 * anything the browser bundle reaches (`./constants` is browser-safe, this is
 * not).
 */

import type { ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web'

import {
  type AttributionRecord,
  buildAttributionRecord,
  encodeLogComment,
  encodeSqlComment,
} from './record'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface AttributionPrincipal {
  readonly subject: string
  readonly email?: string
}

export interface AttributionScope {
  /**
   * Resolves the signed-in principal. Lazy because resolving it can cost a
   * session verify, and most requests that open a scope never query
   * ClickHouse. The middleware memoizes it per request.
   */
  readonly principal?: () => Promise<AttributionPrincipal | null>
  readonly source?: string
  readonly page?: string
}

export interface AttributionConfig {
  readonly enabled: boolean
  readonly sqlComment: boolean
  readonly includeEmail: boolean
  readonly label: string | null
  readonly version: string | null
}

const storage = new AsyncLocalStorage<AttributionScope>()

/** Run `fn` with `patch` layered over the current scope. */
export function runWithAttribution<T>(patch: AttributionScope, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...patch }, fn)
}

export function currentAttributionScope(): AttributionScope | undefined {
  return storage.getStore()
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
}

let appVersion: string | null = null

/** Set once at startup by the app; the package cannot see its build info. */
export function setAttributionVersion(version: string | null): void {
  appVersion = version
}

/** Read per call: env is bridged onto `process.env` after module load on Workers. */
export function getAttributionConfig(): AttributionConfig {
  const env = process.env
  return {
    enabled: envBool(env.CHM_QUERY_ATTRIBUTION, true),
    sqlComment: envBool(env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT, false),
    includeEmail: envBool(env.CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL, false),
    label: env.CHM_QUERY_ATTRIBUTION_LABEL?.trim() || null,
    version: appVersion,
  }
}

let envHostsAreDemo: () => boolean = () => false

/**
 * Set once at startup by the app: whether the env-configured hosts are a
 * public demo (cloud mode). The package cannot see the deployment mode.
 * Read per call, like the config, because env lands on `process.env` late.
 */
export function setEnvHostsAreDemo(resolve: () => boolean): void {
  envHostsAreDemo = resolve
}

export function isEnvHostDemo(): boolean {
  try {
    return envHostsAreDemo()
  } catch {
    return false
  }
}

export interface AttributionOptions {
  /**
   * True when the target host is a public demo. Its `system.query_log` is
   * readable by every visitor, so the record leaves out `user` and `email`.
   */
  readonly anonymous?: () => boolean
}

export async function resolveAttributionRecord(
  host: string | null,
  config: AttributionConfig = getAttributionConfig(),
  options: AttributionOptions = {}
): Promise<AttributionRecord> {
  const scope = storage.getStore()
  let principal: AttributionPrincipal | null = null
  if (!options.anonymous?.()) {
    try {
      principal = (await scope?.principal?.()) ?? null
    } catch {
      // Attribution must never fail a query; an unresolvable principal is anonymous.
    }
  }
  return buildAttributionRecord({
    version: config.version,
    user: principal?.subject ?? null,
    email: config.includeEmail ? (principal?.email ?? null) : null,
    host,
    source: scope?.source ?? null,
    page: scope?.page ?? null,
    label: config.label,
  })
}

type QueryLikeParams = {
  query?: string
  clickhouse_settings?: Record<string, unknown>
}

/**
 * Which carriers a request gets. `sqlCommentOnly` is the fallback for a user
 * whose profile is `readonly = 1`: that level refuses every changed setting,
 * `log_comment` included (measured on ClickHouse 23.8 and 26.5).
 */
export type AttributionCarriers = 'configured' | 'sqlCommentOnly'

/**
 * Add the attribution carriers to one request's params. Returns `params`
 * unchanged when attribution is off.
 */
export async function attributeParams<T>(
  params: T,
  host: string | null,
  carriers: AttributionCarriers = 'configured',
  options: AttributionOptions = {}
): Promise<T> {
  if (params === null || typeof params !== 'object') return params
  const config = getAttributionConfig()
  if (!config.enabled) return params

  const record = await resolveAttributionRecord(host, config, options)
  const p = params as QueryLikeParams
  const withComment = config.sqlComment || carriers === 'sqlCommentOnly'
  return {
    ...p,
    ...(withComment && typeof p.query === 'string'
      ? { query: encodeSqlComment(record) + p.query }
      : {}),
    ...(carriers === 'configured'
      ? {
          clickhouse_settings: {
            log_comment: encodeLogComment(record),
            ...p.clickhouse_settings,
          },
        }
      : {}),
  } as T
}

const LOG_COMMENT_REFUSED =
  /Cannot modify 'log_comment' setting in readonly mode/

/** ClickHouse `READONLY` error code; `ClickHouseError.code` carries it as a string. */
const READONLY_CODE = '164'

/**
 * True only for the server's readonly refusal of `log_comment`: the error
 * object carries code 164 and the message names `log_comment`. The message
 * alone is not enough, because a query can raise any text it likes
 * (`throwIf(1, 'Cannot modify ''log_comment''...')`).
 */
export function isLogCommentRefused(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  return (
    String(code) === READONLY_CODE &&
    typeof message === 'string' &&
    LOG_COMMENT_REFUSED.test(message)
  )
}

type RequestMethods = {
  query?: (params: unknown) => Promise<unknown>
  command?: (params: unknown) => Promise<unknown>
}

/**
 * Attach attribution to every `query()` / `command()` on `client`.
 *
 * Mutates in place for the same reason as `withReadonlyEnforcement`: the pool
 * and `releaseClient()` key on this exact instance.
 *
 * When the server refuses `log_comment` (a `readonly = 1` profile), the client
 * switches to the SQL comment for every later request. A refused `query()` is
 * resent once; a refused `command()` is not, because a command is not
 * idempotent, so that one call fails and the next one uses the SQL comment.
 */
export function withQueryAttribution<
  T extends ClickHouseClient | WebClickHouseClient,
>(client: T, host: string | null, options: AttributionOptions = {}): T {
  const target = client as unknown as RequestMethods
  let carriers: AttributionCarriers = 'configured'
  for (const method of ['query', 'command'] as const) {
    const original = target[method]
    if (typeof original !== 'function') continue
    const send = async (params: unknown, mode: AttributionCarriers) =>
      original.call(client, await attributeParams(params, host, mode, options))
    target[method] = async (params: unknown) => {
      if (carriers === 'sqlCommentOnly') return send(params, carriers)
      try {
        return await send(params, carriers)
      } catch (err) {
        if (!isLogCommentRefused(err)) throw err
        carriers = 'sqlCommentOnly'
        if (method === 'command') throw err
        return send(params, carriers)
      }
    }
  }
  return client
}
