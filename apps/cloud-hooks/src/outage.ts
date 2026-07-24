/**
 * Outage escalation — keep reminding while a surface stays down.
 *
 * `diffStates` (probes.ts) notifies only when a surface CHANGES state, which is
 * right for avoiding a 15-minute drumbeat but leaves a real hole: a surface that
 * goes down at 02:00 produces exactly one message and then silence, however long
 * it stays broken. Miss that one notification and nothing ever tells you again.
 *
 * This module tracks, per surface, when it went down and when it was last
 * alerted about, and re-alerts on a WIDENING schedule (30m → 2h → 6h → daily).
 * Widening is the point: the first hour matters most, and an outage you have
 * already been told about four times does not need a fifth reminder every 15
 * minutes. The recovery message carries the total downtime, which is the number
 * you actually want afterwards.
 *
 * State lives in its own KV key so `probe-state:v1` (read by the digest) keeps
 * its existing shape.
 */

/**
 * Minimal KV subset (matches probes' / github-app's `KVLike`). Declared locally
 * rather than imported so this module has NO dependency on probes.ts — probes
 * imports this one, and a mutual import would be a cycle.
 */
export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

/**
 * The part of a probe result this module needs. Structural, so probes' richer
 * `ProbeResult` satisfies it without either module depending on the other.
 */
export interface ProbeOutcome {
  name: string
  state: 'up' | 'down'
  status?: number
  error?: string
}

export const OUTAGE_KV_KEY = 'probe-outage:v1'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * Elapsed-time thresholds at which an ongoing outage is re-announced, measured
 * from when it started. After the last step, reminders repeat at that final
 * interval (daily).
 */
export const ESCALATION_STEPS_MS = [30 * MINUTE, 2 * HOUR, 6 * HOUR, 24 * HOUR]

/** Per-surface outage record. */
export interface OutageRecord {
  /** Epoch ms when the surface was first observed down. */
  downSince: number
  /** Epoch ms of the most recent alert (initial or reminder). */
  lastAlertAt: number
  /** How many reminders (excluding the initial alert) have been sent. */
  reminders: number
}

export type OutageState = Record<string, OutageRecord>

export interface OutageAlert {
  name: string
  kind: 'ongoing' | 'recovered'
  /** How long the surface has been (or was) down, in ms. */
  downtimeMs: number
  status?: number
  error?: string
}

/** Human-readable duration: "45m", "2h 15m", "1d 3h". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * When is the next reminder due for an outage that started `downSince` and has
 * already sent `reminders` reminders? Returns the absolute epoch-ms deadline.
 * Past the last step, reminders repeat at the final interval.
 */
export function nextReminderAt(record: OutageRecord): number {
  const steps = ESCALATION_STEPS_MS
  if (record.reminders < steps.length) {
    return record.downSince + steps[record.reminders]
  }
  const overflow = record.reminders - steps.length + 1
  return record.downSince + steps[steps.length - 1] * (overflow + 1)
}

/**
 * Fold this run's probe results into the stored outage state.
 *
 * Pure: returns the alerts to send and the state to persist, so the escalation
 * schedule is testable by advancing a clock rather than by waiting.
 *
 * A surface that is down and already tracked produces an `ongoing` alert only
 * when its next reminder is due. A surface that recovered produces exactly one
 * `recovered` alert carrying total downtime, and is dropped from the state.
 */
export function reconcileOutages(
  prev: OutageState,
  results: ProbeOutcome[],
  now: number
): { alerts: OutageAlert[]; next: OutageState } {
  const alerts: OutageAlert[] = []
  const next: OutageState = {}

  for (const result of results) {
    const record = prev[result.name]

    if (result.state === 'down') {
      if (!record) {
        // First time down. `diffStates` already sends the initial alert, so we
        // only start the clock here — alerting twice about the same event would
        // be worse than not escalating at all.
        next[result.name] = {
          downSince: now,
          lastAlertAt: now,
          reminders: 0,
        }
        continue
      }
      if (now >= nextReminderAt(record)) {
        alerts.push({
          name: result.name,
          kind: 'ongoing',
          downtimeMs: now - record.downSince,
          status: result.status,
          error: result.error,
        })
        next[result.name] = {
          ...record,
          lastAlertAt: now,
          reminders: record.reminders + 1,
        }
      } else {
        next[result.name] = record
      }
      continue
    }

    // Back up: report total downtime once, then forget it.
    if (record) {
      alerts.push({
        name: result.name,
        kind: 'recovered',
        downtimeMs: now - record.downSince,
      })
    }
  }

  return { alerts, next }
}

export function formatOutageAlert(alert: OutageAlert): string {
  const duration = formatDuration(alert.downtimeMs)
  if (alert.kind === 'recovered') {
    return `\u{1F7E2} <b>${alert.name}</b> RECOVERED — was down ${duration}`
  }
  const detail = alert.status
    ? ` (HTTP ${alert.status})`
    : alert.error
      ? ` (${alert.error})`
      : ''
  return `\u{1F534} <b>${alert.name}</b> STILL DOWN — ${duration}${detail}`
}

/** Read the stored outage state. Any problem → empty (we simply re-start clocks). */
export async function readOutageState(
  kv: KVLike | null | undefined
): Promise<OutageState> {
  if (!kv) return {}
  try {
    const raw = await kv.get(OUTAGE_KV_KEY)
    return raw ? (JSON.parse(raw) as OutageState) : {}
  } catch {
    return {}
  }
}

/** Persist the outage state. Never throws — a KV hiccup must not fail the cron. */
export async function writeOutageState(
  kv: KVLike | null | undefined,
  state: OutageState,
  logError: (message: string, meta?: unknown) => void = (m, meta) =>
    console.error(m, meta)
): Promise<void> {
  if (!kv) return
  try {
    await kv.put(OUTAGE_KV_KEY, JSON.stringify(state))
  } catch (err) {
    logError('[cloud-hooks] failed to persist outage state to KV', err)
  }
}
