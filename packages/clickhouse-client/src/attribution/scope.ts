/**
 * Per-request attribution scope (issue #4164).
 *
 * The ClickHouse client is pooled per host and shared by concurrent requests,
 * so the principal cannot live on the client. The request middleware opens a
 * scope with `AsyncLocalStorage`; entry points narrow it (a chart name, a cron
 * job), and `withQueryAttribution` reads it on every `query()` / `command()`.
 *
 * Server-side: the scope needs `node:async_hooks`. The browser bundle reaches
 * this module through the package index, so nothing here touches it at load
 * time (see `scopeStorage`).
 */

import type { ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web'

import { QUERY_COMMENT } from '../clickhouse/constants'
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

let storage: AsyncLocalStorage<AttributionScope> | null | undefined

/**
 * Created on first use, not at module load: the package index reaches this
 * module, so it lands in the browser bundle too, where `node:async_hooks` is
 * an empty stub and `new AsyncLocalStorage()` would throw on page load.
 * Without it there is no scope, and queries go out anonymous.
 */
function scopeStorage(): AsyncLocalStorage<AttributionScope> | null {
  if (storage === undefined) {
    storage =
      typeof AsyncLocalStorage === 'function'
        ? new AsyncLocalStorage<AttributionScope>()
        : null
  }
  return storage
}

/** Run `fn` with `patch` layered over the current scope. */
export function runWithAttribution<T>(patch: AttributionScope, fn: () => T): T {
  const store = scopeStorage()
  if (!store) return fn()
  return store.run({ ...store.getStore(), ...patch }, fn)
}

export function currentAttributionScope(): AttributionScope | undefined {
  return scopeStorage()?.getStore()
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
    sqlComment: envBool(env.CHM_QUERY_ATTRIBUTION_SQL_COMMENT, true),
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
  const scope = currentAttributionScope()
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
 * Leading minimal `QUERY_COMMENT`s, with any whitespace around them. Call
 * sites and query configs still prepend it (some twice: the config embeds it
 * and fetch adds another), so it is stripped before the one leading comment
 * this module writes.
 */
const LEADING_QUERY_COMMENTS =
  /^\s*(?:\/\*\s*\{\s*"client"\s*:\s*"clickhouse-monitoring"\s*\}\s*\*\/\s*)+/

function usesQueryCache(
  settings: Record<string, unknown> | undefined
): boolean {
  const value = settings?.use_query_cache
  return value === 1 || value === true || value === '1' || value === 'true'
}

export function stripQueryComment(query: string): string {
  return query.replace(LEADING_QUERY_COMMENTS, '')
}

/**
 * Add the attribution carriers to one request's params.
 *
 * The query always leaves with exactly one leading comment: the attribution
 * comment, or the minimal `QUERY_COMMENT` when attribution or the SQL comment
 * is off, so self-filters on `"client":"clickhouse-monitoring"` keep working.
 */
export async function attributeParams<T>(
  params: T,
  host: string | null,
  carriers: AttributionCarriers = 'configured',
  options: AttributionOptions = {}
): Promise<T> {
  if (params === null || typeof params !== 'object') return params
  const p = params as QueryLikeParams
  const config = getAttributionConfig()
  if (!config.enabled) {
    return typeof p.query === 'string'
      ? ({ ...p, query: QUERY_COMMENT + stripQueryComment(p.query) } as T)
      : params
  }

  const record = await resolveAttributionRecord(host, config, options)
  const hasQuery = typeof p.query === 'string'
  const withComment = config.sqlComment || carriers === 'sqlCommentOnly'
  // `log_comment` is part of the query cache key before ClickHouse 25.x
  // (measured: 24.8 misses, 26.5 hits), so a per-user value would split one
  // cached chart into one entry per user. When the comment carries the
  // record, a cached query leaves `log_comment` out.
  const withLogComment =
    carriers === 'configured' &&
    !(withComment && hasQuery && usesQueryCache(p.clickhouse_settings))
  return {
    ...p,
    ...(typeof p.query === 'string'
      ? {
          query:
            (withComment ? encodeSqlComment(record) : QUERY_COMMENT) +
            stripQueryComment(p.query),
        }
      : {}),
    ...(withLogComment
      ? {
          clickhouse_settings: {
            log_comment: encodeLogComment(record),
            ...p.clickhouse_settings,
          },
        }
      : {}),
  } as T
}

/**
 * The SQL to show in the dashboard's SQL dialog: `query` with the leading
 * comment it is sent with, except `user`, which is always `null` here.
 * Chart and table responses can sit in a shared edge cache
 * (`Cache-Control: public`), so one user's id must not reach another.
 */
export function displaySql(query: string, host: string | null): string {
  const config = getAttributionConfig()
  const body = stripQueryComment(query)
  if (!config.enabled || !config.sqlComment) return QUERY_COMMENT + body
  const record = buildAttributionRecord({
    version: config.version,
    user: null,
    email: null,
    host,
    source: currentAttributionScope()?.source ?? null,
    page: null,
    label: config.label,
  })
  return encodeSqlComment(record) + body
}

/** Host name the attribution record carries for a configured host. */
export function attributionHostName(config: {
  id: number
  customName?: string
}): string {
  return config.customName ?? `host-${config.id}`
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
