/**
 * Activation — do the people who sign up ever connect a cluster?
 *
 * A signup that never adds a connection got nothing from the product. That is
 * the single most diagnostic number for a self-serve tool, and it is invisible
 * in a digest that reports signups and subscriptions separately: signups can
 * look healthy while every one of them bounces off a broken connection form.
 *
 * Measured from `user_connections` in the billing D1 (rows created in the
 * window, and how many DISTINCT users they belong to) against the Clerk signup
 * count the digest already fetches. Deliberately a digest line rather than its
 * own alert — it is a trend to watch, not an incident — EXCEPT for the
 * stalled case below, which is flagged inline.
 */

import type { D1SummaryDb } from './summary'

export interface ActivationData {
  /** Connections created in the window. */
  newConnections: number
  /** Distinct users who created at least one connection in the window. */
  activatedUsers: number
  /** Signups in the same window, when known (Clerk). */
  signups: number | null
}

/**
 * Activated users as a percentage of signups. Null when signups are unknown or
 * zero — a rate needs a denominator, and "0%" of nothing is misleading.
 */
export function activationRate(data: ActivationData): number | null {
  if (data.signups === null || data.signups <= 0) return null
  return Math.round((data.activatedUsers / data.signups) * 1000) / 10
}

/**
 * The case worth flagging: people signed up and NOT ONE of them connected
 * anything. With a handful of signups that is ordinary noise, so it only counts
 * as stalled once enough people have tried.
 */
export const STALL_MIN_SIGNUPS = 3

export function isStalled(data: ActivationData): boolean {
  return (
    data.signups !== null &&
    data.signups >= STALL_MIN_SIGNUPS &&
    data.activatedUsers === 0
  )
}

/**
 * Count connections created in `[since, now)`. `since` is unix seconds.
 * Returns null on failure so the digest omits the section.
 */
export async function collectActivation(
  db: D1SummaryDb | null | undefined,
  since: number,
  signups: number | null,
  logError: (message: string, meta?: unknown) => void = (m, meta) =>
    console.error(m, meta)
): Promise<ActivationData | null> {
  if (!db) return null
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
           FROM user_connections
          WHERE created_at >= ?1`
      )
      .bind(since)
      .first<{ n: number; users: number }>()
    if (!row) return null
    return {
      newConnections: row.n ?? 0,
      activatedUsers: row.users ?? 0,
      signups,
    }
  } catch (err) {
    logError('[cloud-hooks] activation query failed', err)
    return null
  }
}

/**
 * The Activation block of a digest. Returns [] when unavailable so the caller
 * can spread it unconditionally.
 */
export function activationLines(
  data: ActivationData | null | undefined
): string[] {
  if (!data) return []
  const rate = activationRate(data)
  const lines = [
    '',
    `\u{1F331} <b>Activation</b>`,
    `  • Connected a cluster: ${data.activatedUsers}${
      rate === null ? '' : ` of ${data.signups} signups (${rate}%)`
    }`,
    `  • New connections: ${data.newConnections}`,
  ]
  if (isStalled(data)) {
    lines.push(
      `  \u{26A0}\u{FE0F} <b>${data.signups} signups, zero connected</b> — check the connection flow`
    )
  }
  return lines
}
