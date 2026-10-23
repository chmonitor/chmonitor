/**
 * Native Matrix delivery (transport layer) via the Client-Server API:
 *
 *   PUT {homeserver}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
 *   Authorization: Bearer <access token>
 *
 * The event content comes from the pure formatter `adapters/matrix.ts`
 * (`buildMatrixBody` / `buildMatrixDigestBody`), the same body the custom
 * webhook `matrix` format sends through a bridge. This module only builds the
 * URL + headers and talks to the homeserver.
 *
 * The homeserver URL is OPERATOR-SUPPLIED for a route, so the CRUD/test layers
 * validate it with `validateHostUrl` before it is stored or used; the env URL
 * is operator-set and trusted. Redirects are refused so a 30x cannot bounce the
 * request (and its bearer token) to a host the guard never saw.
 *
 * Never throws: a delivery failure must not abort the health sweep loop.
 */

import type { AlertPayload } from './adapters/types'

import { buildMatrixBody } from './adapters/matrix'
import { error } from '@chm/logger'

/** Where to send: homeserver base URL, a bot access token, a room id. */
export interface MatrixConfig {
  homeserverUrl: string
  accessToken: string
  roomId: string
}

export interface MatrixDispatchDeps {
  fetchImpl?: typeof fetch
}

/**
 * A room id (`!opaque` or `!opaque:server`), never an alias: the send endpoint
 * takes a Room ID, aliases only work on `/join/{roomIdOrAlias}`. At most 255
 * bytes, no whitespace or control characters.
 */
export function isValidMatrixRoomId(roomId: string): boolean {
  if (!/^![^\s\p{Cc}]+$/u.test(roomId)) return false
  return new TextEncoder().encode(roomId).length <= 255
}

/**
 * Parse a homeserver base URL into its stored form: `origin + pathname` with
 * trailing slashes stripped (a path prefix, for a reverse proxy mounting
 * Synapse under `/matrix`, is kept). Returns null for anything that could
 * smuggle other parts into the send URL or the request: credentials, a query,
 * a fragment, or a non-https scheme. `allowHttp` is for the operator-set env
 * config only (a LAN homeserver); saved routes and the test endpoint are https.
 */
export function parseMatrixHomeserverUrl(
  raw: string,
  options: { allowHttp?: boolean } = {}
): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const schemeOk =
    url.protocol === 'https:' ||
    (options.allowHttp === true && url.protocol === 'http:')
  if (!schemeOk) return null
  if (url.username || url.password || url.search || url.hash) return null
  return url.origin + url.pathname.replace(/\/+$/, '')
}

/**
 * The send URL. The homeserver URL may carry a path prefix (a reverse proxy
 * mounting Synapse under `/matrix`), which is kept; a trailing slash is not.
 * Built from the normalized base, so a query or fragment in a stored value
 * cannot end up in the path.
 */
export function buildMatrixSendUrl(
  homeserverUrl: string,
  roomId: string,
  txnId: string
): string {
  const base =
    parseMatrixHomeserverUrl(homeserverUrl, { allowHttp: true }) ??
    homeserverUrl.replace(/[?#].*$/, '').replace(/\/+$/, '')
  return `${base}/_matrix/client/v3/rooms/${encodePathSegment(roomId)}/send/m.room.message/${encodePathSegment(txnId)}`
}

/** `encodeURIComponent` plus the sub-delims it leaves bare (`!'()*`). */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * A transaction id that is the same for a retry of one notification and
 * different for every other one. The spec scopes txn ids to the access token,
 * so the room is part of the key (one token, two rooms, two ids).
 */
export async function buildMatrixTxnId(
  parts: readonly string[]
): Promise<string> {
  const data = new TextEncoder().encode(parts.join('\u0000'))
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  return `chm-${hex.slice(0, 32)}`
}

/**
 * The txn id for one alert payload in one room: host, rule, severity, and the
 * payload's full-precision timestamp. The sweep stamps one payload per
 * notification (`buildChannelPayload`), so the timestamp tells two
 * notifications apart even within one minute, while a retry of the same
 * payload reuses it. A minute bucket collided and the homeserver dropped the
 * second event as a duplicate of the first.
 */
export function matrixTxnIdForPayload(
  payload: AlertPayload,
  roomId: string
): Promise<string> {
  return buildMatrixTxnId([
    roomId,
    String(payload.hostId ?? ''),
    payload.metric,
    payload.severity,
    payload.timestamp,
  ])
}

/** Result of one send: `ok`, plus the Matrix `errcode` on failure (no secrets). */
export interface MatrixSendResult {
  ok: boolean
  status?: number
  errcode?: string
}

/** PUT one event's content to a room. Never throws. */
export async function sendMatrixEvent(
  config: MatrixConfig,
  content: object,
  txnId: string,
  deps: MatrixDispatchDeps = {}
): Promise<MatrixSendResult> {
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await doFetch(
      buildMatrixSendUrl(config.homeserverUrl, config.roomId, txnId),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(content),
        redirect: 'manual',
        signal: controller.signal,
      }
    )
    if (res.ok) return { ok: true, status: res.status }
    let errcode: string | undefined
    try {
      const json = (await res.json()) as { errcode?: unknown }
      if (typeof json.errcode === 'string') errcode = json.errcode
    } catch {
      // Non-JSON error body: the status is enough.
    }
    error(
      '[health] matrix dispatch returned non-OK status',
      new Error(`Status ${res.status}${errcode ? ` ${errcode}` : ''}`)
    )
    return { ok: false, status: res.status, errcode }
  } catch (err) {
    error('[health] matrix dispatch failed', err as Error)
    return { ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

/** Send one alert to a room as an `m.notice`. Never throws. */
export async function dispatchMatrix(
  payload: AlertPayload,
  config: MatrixConfig,
  deps: MatrixDispatchDeps & { txnId?: string } = {}
): Promise<MatrixSendResult> {
  const txnId =
    deps.txnId ?? (await matrixTxnIdForPayload(payload, config.roomId))
  return sendMatrixEvent(config, buildMatrixBody(payload), txnId, deps)
}
