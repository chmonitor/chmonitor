/**
 * Native Matrix rooms via the Client-Server API. Digest-capable like Telegram
 * and the custom Matrix format: the sweep collects one entry per resolved room
 * and the grouped flush (`./../digest.ts`) sends one message per room.
 */

import type { MatrixTarget } from './../../../alert-routing'
import type { MatrixSendResult } from './../../../matrix-dispatch'

import { sendMatrixEvent } from './../../../matrix-dispatch'
import { debug } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/** One resolved room; `trusted` = the operator-set env room (no SSRF check). */
export interface MatrixChannelEntry {
  target: MatrixTarget
  trusted: boolean
}

const isSameTarget = (a: MatrixTarget, b: MatrixTarget | null) =>
  b !== null &&
  a.homeserverUrl === b.homeserverUrl &&
  a.roomId === b.roomId &&
  a.accessToken === b.accessToken

/**
 * Tag each resolved room with whether it is the env-configured one (compared
 * by value). Every other room is a saved route, re-validated at send time.
 */
export function matrixChannelEntries(
  matrixTargets: readonly MatrixTarget[],
  envTarget: MatrixTarget | null
): MatrixChannelEntry[] {
  return matrixTargets.map((target) => ({
    target,
    trusted: isSameTarget(target, envTarget),
  }))
}

/**
 * PUT one event to a room. A saved route's homeserver is re-validated against
 * the SSRF guard right before sending (DNS can change after save); a blocked
 * one is never fetched. Never throws.
 */
export async function sendMatrixChannel(
  entry: MatrixChannelEntry,
  content: object,
  txnId: string
): Promise<MatrixSendResult & { blocked?: true }> {
  if (!entry.trusted && (await validateHostUrl(entry.target.homeserverUrl))) {
    debug('[health-sweep] skipping matrix target: blocked destination')
    return { ok: false, blocked: true }
  }
  return sendMatrixEvent(entry.target, content, txnId)
}

/** The alert-history error text for a failed send (no secrets). */
export function matrixSendError(
  result: MatrixSendResult & { blocked?: true }
): string | undefined {
  if (result.ok) return undefined
  if (result.blocked) return 'matrix dispatch failed (destination blocked)'
  if (result.errcode) return `matrix dispatch failed (${result.errcode})`
  if (result.status) return `matrix dispatch failed (HTTP ${result.status})`
  return 'matrix dispatch failed'
}
