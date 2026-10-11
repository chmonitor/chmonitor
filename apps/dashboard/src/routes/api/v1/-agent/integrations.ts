/**
 * Resolve the agent's read-only integration tools (PeerDB, Postgres) for one
 * request (#3674). The probe is awaited here, BEFORE the synchronous agent
 * factory, so `createClickHouseAgent` stays sync and only receives booleans.
 *
 * Reachability is pinned per conversation: when the incoming history carries
 * a pin (see `readIntegrationPin`), it is reused and nothing is probed. The
 * policy part of the decision (flags, kill switch, cloud rules, configured) is
 * recomputed every turn.
 */

import type { ProbeCache } from '@/lib/ai/agent/integration-probe'

import { getPostgresConfigs } from '@chm/postgres-client'
import { integrationProbeCache } from '@/lib/ai/agent/integration-probe'
import {
  formatIntegrationReason,
  type IntegrationDecision,
  type IntegrationGateInput,
  type IntegrationName,
  type IntegrationPin,
  peerdbGateInput,
  postgresGateInput,
  resolveIntegrationPolicy,
  resolveIntegrationToolsEnabled,
} from '@/lib/ai/agent/integration-tools-gate'
import { getPeerDBAgentConfig } from '@/lib/ai/agent/tools/peerdb-helpers'

export interface AgentIntegrations {
  /** Booleans for createAllTools(). */
  integrations: Record<IntegrationName, boolean>
  decisions: Record<IntegrationName, IntegrationDecision>
  /** Pin to store with the conversation (absent when nothing was probed). */
  pin: IntegrationPin | undefined
}

export interface ResolveAgentIntegrationsInput {
  cloud: boolean
  signedIn: boolean
  /** The request is bound to the caller's own saved connection. */
  ownConnection: boolean
  /** Pin read from the incoming conversation history, if any. */
  pin: IntegrationPin | undefined
  /** Test seams. */
  probeCache?: ProbeCache
  gateInputs?: Record<IntegrationName, IntegrationGateInput>
}

function postgresConfigured(): boolean {
  try {
    return getPostgresConfigs().length > 0
  } catch {
    return false
  }
}

function envGateInputs(
  ctx: Pick<
    ResolveAgentIntegrationsInput,
    'cloud' | 'signedIn' | 'ownConnection'
  >
): Record<IntegrationName, IntegrationGateInput> {
  return {
    peerdb: peerdbGateInput({
      ...ctx,
      configured: getPeerDBAgentConfig() !== null,
    }),
    postgres: postgresGateInput({ ...ctx, configured: postgresConfigured() }),
  }
}

export async function resolveAgentIntegrations(
  input: ResolveAgentIntegrationsInput
): Promise<AgentIntegrations> {
  const probeCache = input.probeCache ?? integrationProbeCache
  const gates = input.gateInputs ?? envGateInputs(input)
  const names = Object.keys(gates) as IntegrationName[]
  const newPin: IntegrationPin = { ...input.pin }
  let probed = false

  const decided = await Promise.all(
    names.map(async (name): Promise<[IntegrationName, IntegrationDecision]> => {
      const gate = gates[name]
      const policy = resolveIntegrationPolicy(gate)
      if (policy) return [name, policy]
      let reachability = input.pin?.[name]
      if (!reachability) {
        reachability = await probeCache.check(name)
        newPin[name] = reachability
        probed = true
      }
      return [name, resolveIntegrationToolsEnabled({ ...gate, reachability })]
    })
  )

  const decisions = Object.fromEntries(decided) as Record<
    IntegrationName,
    IntegrationDecision
  >
  logIntegrationDecisions(decisions, callerClass(input))
  return {
    integrations: {
      peerdb: decisions.peerdb.enabled,
      postgres: decisions.postgres.enabled,
    },
    decisions,
    pin: probed || input.pin ? newPin : undefined,
  }
}

/**
 * Decisions depend on the caller (cloud anon vs signed-in, own connection vs
 * env host), so the "state" that is logged once per change is tracked per
 * caller class — otherwise mixed traffic would log on almost every request.
 * At most 8 classes.
 */
function callerClass(
  input: Pick<
    ResolveAgentIntegrationsInput,
    'cloud' | 'signedIn' | 'ownConnection'
  >
): string {
  return [
    input.cloud ? 'cloud' : 'oss',
    input.signedIn ? 'user' : 'anon',
    input.ownConnection ? 'conn' : 'env',
  ].join(':')
}

const lastLogged = new Map<string, string>()

/**
 * One structured line per isolate per state change (per caller class).
 * Reasons are fixed labels plus a failure kind — never a URL or credential.
 */
export function logIntegrationDecisions(
  decisions: Record<IntegrationName, IntegrationDecision>,
  caller: string
): void {
  const line = {
    caller,
    peerdb: decisions.peerdb.enabled ? 'on' : 'off',
    postgres: decisions.postgres.enabled ? 'on' : 'off',
    reason: {
      peerdb: formatIntegrationReason(decisions.peerdb),
      postgres: formatIntegrationReason(decisions.postgres),
    },
  }
  const key = JSON.stringify(line)
  if (lastLogged.get(caller) === key) return
  lastLogged.set(caller, key)
  console.log('agent.integration_tools', line)
}

/** Test helper. */
export function resetIntegrationLogState(): void {
  lastLogged.clear()
}

/** One-line system-prompt hint so the model knows to look for the tools. */
export function integrationPromptHint(
  integrations: Record<IntegrationName, boolean>
): string {
  const on: string[] = []
  if (integrations.peerdb) on.push('PeerDB mirror status and metrics')
  if (integrations.postgres) on.push('Postgres source queries and stats')
  if (on.length === 0) return ''
  return `\n\nRead-only integration tools available: ${on.join('; ')}. Find them with \`search_tools\`.`
}
