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

export async function resolveAttributionRecord(
  host: string | null,
  config: AttributionConfig = getAttributionConfig()
): Promise<AttributionRecord> {
  const scope = storage.getStore()
  let principal: AttributionPrincipal | null = null
  try {
    principal = (await scope?.principal?.()) ?? null
  } catch {
    // Attribution must never fail a query; an unresolvable principal is anonymous.
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
  carriers: AttributionCarriers = 'configured'
): Promise<T> {
  if (params === null || typeof params !== 'object') return params
  const config = getAttributionConfig()
  if (!config.enabled) return params

  const record = await resolveAttributionRecord(host, config)
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

/** True only for the readonly refusal that names `log_comment` itself. */
export function isLogCommentRefused(err: unknown): boolean {
  return LOG_COMMENT_REFUSED.test(String((err as Error)?.message ?? err))
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
 * When the server refuses `log_comment` (a `readonly = 1` profile), the request
 * is resent once with the SQL comment instead, and the client remembers it.
 * The retry keys on the error naming `log_comment`, so a refused write or a
 * refusal of any other setting is never retried.
 */
export function withQueryAttribution<
  T extends ClickHouseClient | WebClickHouseClient,
>(client: T, host: string | null): T {
  const target = client as unknown as RequestMethods
  let carriers: AttributionCarriers = 'configured'
  for (const method of ['query', 'command'] as const) {
    const original = target[method]
    if (typeof original !== 'function') continue
    const send = async (params: unknown, mode: AttributionCarriers) =>
      original.call(client, await attributeParams(params, host, mode))
    target[method] = async (params: unknown) => {
      if (carriers === 'sqlCommentOnly') return send(params, carriers)
      try {
        return await send(params, carriers)
      } catch (err) {
        if (!isLogCommentRefused(err)) throw err
        carriers = 'sqlCommentOnly'
        return send(params, carriers)
      }
    }
  }
  return client
}
