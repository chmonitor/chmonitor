// The ONE resolver for whether the agent gets the read-only integration tools
// (PeerDB mirror status / metrics, Postgres cross-source tools). The agent
// route resolves it once per conversation and passes the booleans to
// createAllTools() as `integrations`. Modeled on control-tools-gate.ts.
//
// Checks run top to bottom (decision table):
//   1. flag false (parseBool grammar) or the integration's kill switch → off
//   2. anonymous cloud visitor                                         → off
//   3. not configured                                                  → off
//   4. flag true                                                       → on
//      (the operator chose it; execution still fails closed at call time)
//   5. flag unset, cloud or bound to the caller's own connection       → off
//      (the source is deployment env, so it is the operator's data, not the
//      caller's — it needs an explicit opt-in)
//   6. flag unset, reachable                                           → on
//   7. flag unset, unreachable / probe timed out / unknown             → off
//
// The tools are read-only either way; this only decides whether the model is
// told they exist.

import { parseBool } from '@/lib/config/parse-bool'

export type IntegrationName = 'peerdb' | 'postgres'

export const INTEGRATION_NAMES: readonly IntegrationName[] = [
  'peerdb',
  'postgres',
]

/**
 * Result of one reachability probe. `kind` is a short failure class
 * (`timeout`, `auth`, `refused`, a SQLSTATE, `probe_timeout`, …) — never a
 * message, URL, or credential.
 */
export type Reachability = { ok: true } | { ok: false; kind: string }

export type IntegrationReason =
  | 'flag_false'
  | 'kill_switch'
  | 'cloud_anon'
  | 'unconfigured'
  | 'flag_true'
  | 'needs_opt_in'
  | 'auto'
  | 'probe_timeout'
  | 'unreachable'
  | 'unknown'

export interface IntegrationDecision {
  enabled: boolean
  reason: IntegrationReason
  /** Failure kind when `reason` is `unreachable`. */
  kind?: string
}

export interface IntegrationGateInput {
  /** Raw per-integration flag (CHM_FEATURE_PEERDB_AGENT / CHM_FEATURE_POSTGRES_SOURCE). */
  flag: string | null | undefined
  /** A hard kill switch other than the flag (CHM_FEATURE_PEERDB_ENABLED=false). */
  killSwitch?: boolean
  /** The integration is configured for this caller (see the route). */
  configured: boolean
  cloud: boolean
  signedIn: boolean
  ownConnection?: boolean
  /** Probe result; `undefined` = not probed. Only consulted at step 6/7. */
  reachability?: Reachability
}

/**
 * Steps 1-5 only: the decision when it does not depend on reachability, or
 * `null` when a probe is needed to decide. The route uses this to skip
 * probing integrations that are off (or forced on) anyway.
 */
export function resolveIntegrationPolicy(
  input: Omit<IntegrationGateInput, 'reachability'>
): IntegrationDecision | null {
  const explicit = parseBool(input.flag)
  if (explicit === false) return { enabled: false, reason: 'flag_false' }
  if (input.killSwitch) return { enabled: false, reason: 'kill_switch' }
  if (input.cloud && !input.signedIn) {
    return { enabled: false, reason: 'cloud_anon' }
  }
  if (!input.configured) return { enabled: false, reason: 'unconfigured' }
  if (explicit === true) return { enabled: true, reason: 'flag_true' }
  if (input.cloud || input.ownConnection) {
    return { enabled: false, reason: 'needs_opt_in' }
  }
  return null
}

export function resolveIntegrationToolsEnabled(
  input: IntegrationGateInput
): IntegrationDecision {
  const policy = resolveIntegrationPolicy(input)
  if (policy) return policy
  const r = input.reachability
  if (!r) return { enabled: false, reason: 'unknown' }
  if (r.ok) return { enabled: true, reason: 'auto' }
  if (r.kind === 'probe_timeout') {
    return { enabled: false, reason: 'probe_timeout' }
  }
  return { enabled: false, reason: 'unreachable', kind: r.kind }
}

export function formatIntegrationReason(d: IntegrationDecision): string {
  return d.reason === 'unreachable' && d.kind
    ? `unreachable:${d.kind}`
    : d.reason
}

/** `CHM_FEATURE_PEERDB_ENABLED=false` hides PeerDB everywhere, agent included. */
export function peerdbKillSwitch(): boolean {
  return parseBool(process.env.CHM_FEATURE_PEERDB_ENABLED) === false
}

/**
 * Gate input for PeerDB from env. `configured` is passed in so the caller
 * decides how it is read (getPeerDBConfig() in the route).
 */
export function peerdbGateInput(
  ctx: Omit<IntegrationGateInput, 'flag' | 'killSwitch'>
): IntegrationGateInput {
  return {
    ...ctx,
    flag: process.env.CHM_FEATURE_PEERDB_AGENT,
    killSwitch: peerdbKillSwitch(),
  }
}

export function postgresGateInput(
  ctx: Omit<IntegrationGateInput, 'flag' | 'killSwitch'>
): IntegrationGateInput {
  return { ...ctx, flag: process.env.CHM_FEATURE_POSTGRES_SOURCE }
}

//
// The probe result is stored WITH the conversation: the route writes it as a
// `data-integration-tools` part on the assistant message, the client sends the
// history back each turn, and later turns reuse it instead of probing. Only
// reachability is pinned; steps 1-5 are re-run every turn, so a stale or
// edited pin can never bypass a kill switch or the cloud rules.

export const INTEGRATION_PIN_PART_TYPE = 'data-integration-tools'

export type IntegrationPin = Partial<Record<IntegrationName, Reachability>>

const KIND_RE = /^[a-z0-9_]{1,32}$/

function parseReachability(value: unknown): Reachability | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as { ok?: unknown; kind?: unknown }
  if (v.ok === true) return { ok: true }
  if (v.ok === false && typeof v.kind === 'string' && KIND_RE.test(v.kind)) {
    return { ok: false, kind: v.kind }
  }
  return undefined
}

/**
 * Read the most recent pin from the conversation history. Anything that does
 * not match the exact shape is ignored (treated as not pinned).
 */
export function readIntegrationPin(
  messages: ReadonlyArray<{ role?: unknown; parts?: unknown }>
): IntegrationPin | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'assistant' || !Array.isArray(msg.parts)) continue
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j] as { type?: unknown; data?: unknown }
      if (part?.type !== INTEGRATION_PIN_PART_TYPE) continue
      const raw = Array.isArray(part.data) ? part.data[0] : part.data
      if (typeof raw !== 'object' || raw === null) return undefined
      const pin: IntegrationPin = {}
      for (const name of INTEGRATION_NAMES) {
        const r = parseReachability((raw as Record<string, unknown>)[name])
        if (r) pin[name] = r
      }
      return pin
    }
  }
  return undefined
}
