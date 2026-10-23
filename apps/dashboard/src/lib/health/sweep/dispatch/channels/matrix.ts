/**
 * Native Matrix room fan-out via the Client-Server API.
 */

import type { MatrixTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { dispatchMatrix } from './../../../matrix-dispatch'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'
import { debug } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

const isSameTarget = (a: MatrixTarget, b: MatrixTarget | null) =>
  b !== null &&
  a.homeserverUrl === b.homeserverUrl &&
  a.roomId === b.roomId &&
  a.accessToken === b.accessToken

/**
 * Matrix: every resolved room (matched routes, or the env-configured room when
 * nothing matched). One payload per finding, so every room's txn id derives
 * from the same timestamp. Never throws. Returns whether ANY room delivered.
 *
 * A saved route's homeserver is re-validated against the SSRF guard right
 * before sending (DNS can change after save). `envTarget` is the
 * operator-configured room, which is trusted and skips the check. A blocked
 * target is recorded as not delivered and never fetched.
 */
export async function dispatchMatrixChannel(
  finding: FindingContext,
  matrixTargets: MatrixTarget[],
  envTarget: MatrixTarget | null
): Promise<boolean> {
  if (matrixTargets.length === 0) return false
  const payload = buildChannelPayload(finding)
  let anyDelivered = false

  for (const target of matrixTargets) {
    const blocked = isSameTarget(target, envTarget)
      ? null
      : await validateHostUrl(target.homeserverUrl)
    if (blocked) {
      debug('[health-sweep] skipping matrix target: blocked destination')
      await recordChannelEvent(finding, {
        delivered: false,
        error: 'matrix dispatch failed (destination blocked)',
        channel: 'matrix',
      })
      continue
    }
    const result = await dispatchMatrix(payload, target)
    if (result.ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: result.ok,
      error: result.ok
        ? undefined
        : `matrix dispatch failed${result.errcode ? ` (${result.errcode})` : result.status ? ` (HTTP ${result.status})` : ''}`,
      channel: 'matrix',
    })
  }

  return anyDelivered
}
