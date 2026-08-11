/**
 * Sweep context resolution (#2884).
 *
 * Everything the health sweep needs to read ONCE per tick — settings, routes,
 * per-channel config, rules (built-in + custom), threshold/hysteresis
 * overrides, hosts, maintenance/quiet windows, digest window, active ACKs —
 * resolved into a single typed {@link SweepContext}. Extracted verbatim from
 * `runHealthSweep`'s prologue so the orchestrator reads as a pipeline.
 *
 * Every D1-backed read here is best-effort by contract: with no D1 binding
 * (the OSS/self-hosted default) each degrades to its env fallback or an empty
 * list, so an env-only deployment resolves exactly the context it always did.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { CompoundRuleDef } from '@/lib/alerting/compound-rules'
import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { ChannelSettingsMap } from './../alert-channel-settings'
import type { AlertRoute } from './../alert-routing'
import type { AlertAck } from './../alert-ack-store'
import type { MaintenanceWindow } from './../maintenance-windows'
import type { QuietHours } from './../quiet-hours'
import type { AlertSettings } from './../alert-settings-storage'
import type { ResolvedServerChannels } from './../server-channel-resolve'

import { listActiveAcks } from './../alert-ack-store'
import { resolveDigestWindowMinutes } from './../alert-digest-settings-store'
import { listRoutes } from './../alert-routing'
import { hydrateAlertState } from './../alert-state-persist'
import { alertStateStore } from './../alert-state-store'
import { loadCustomRulesIntoRegistry } from './../custom-rules-store'
import { listWindows } from './../maintenance-windows'
import { getPagerDutyFallbackRoutingKey } from './../pagerduty-config'
import { listQuietHours } from './../quiet-hours'
import {
  getServerAlertConfig,
  getServerAlertCooldownMs,
  getServerHysteresisConfig,
  getServerThresholdOverrides,
} from './../server-alert-config'
import { resolveServerChannels } from './../server-channel-resolve'
import { getClickHouseConfigs } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import {
  compoundRuleRegistry,
  topoSortCompound,
} from '@/lib/alerting/compound-rules'
import { ruleRegistry } from '@/lib/alerting/rule-registry'

/**
 * Owner id the sweep loads routes under. The sweep is a session-less cron
 * job over env-configured hosts (`getClickHouseConfigs()`), never per-user D1
 * connections — same reasoning as `alert-history-store.ts`'s host-only
 * scoping — so it uses the OSS single-tenant convention rather than resolving
 * a Clerk user. Per-user cloud routing over env hosts is not in scope here;
 * see plans/30-per-rule-alert-routing.md open question 3.
 */
export const SWEEP_ROUTING_OWNER_ID = ''

/**
 * ACK scope for the sweep. ownerId '' is the OSS single-tenant scope;
 * multi-tenant owner wiring for the cron sweep is a follow-up — see
 * plans/29-alert-ack-manual-resolution.md.
 */
export const SWEEP_ACK_OWNER_ID = ''

export interface SweepContext {
  settings: AlertSettings
  routes: AlertRoute[]
  pagerDutyFallbackKey: string
  channels: ResolvedServerChannels
  channelSettings: ChannelSettingsMap
  /** Master switch for dispatch (dedup + every channel incl. the event bus). */
  alertingEnabled: boolean
  cooldownMs: number
  rules: AlertRuleDef[]
  thresholdOverrides: ReturnType<typeof getServerThresholdOverrides>
  hysteresis: ReturnType<typeof getServerHysteresisConfig>
  orderedCompoundRules: CompoundRuleDef[]
  configs: ClickHouseConfig[]
  windows: MaintenanceWindow[]
  quietHours: QuietHours[]
  /** Effective digest buffer window in ms; `0` = time-window mode off. */
  digestWindowMs: number
  acks: AlertAck[]
}

/**
 * Resolve everything the sweep reads once per tick. The await order is
 * significant in exactly one place: `loadCustomRulesIntoRegistry()` must
 * complete before `ruleRegistry.getAll()`, and the durable alert-state
 * hydration only runs when alerting is enabled.
 */
export async function resolveSweepContext(): Promise<SweepContext> {
  const settings = getServerAlertConfig()
  const routes: AlertRoute[] = await listRoutes(SWEEP_ROUTING_OWNER_ID)
  const pagerDutyFallbackKey = getPagerDutyFallbackRoutingKey()
  // Unified per-channel config (#2665): the D1-persisted UI config, layered
  // over the env readers (D1 row › env fallback per channel). With no D1
  // binding every channel falls through to env, so this is byte-identical to
  // the old direct `getServer*Config()` calls for an env-only deployment.
  const channels = await resolveServerChannels(SWEEP_ROUTING_OWNER_ID)
  // Per-channel overrides (#2661): env `getServerChannelSettings()` overridden
  // by any saved D1 row (#2665). Empty ({}) for a deployment that sets none, so
  // every gate reduces to the historical global `settings.minSeverity`.
  const channelSettings = channels.channelSettings
  // Master switch for `dispatchFinding` (dedup + every channel, INCLUDING the
  // webhook-subscriptions bus). Deliberately NOT ANDed with "is any legacy
  // channel configured" (#2664) — the bus is its own channel and must fire
  // regardless of whether webhook/routes/PagerDuty/Opsgenie/email/Telegram/
  // ntfy/Twilio/Pushover happen to be set up; those per-channel loops inside
  // `dispatchFinding` already no-op cleanly (empty target lists).
  const alertingEnabled = settings.webhookEnabled
  const cooldownMs = getServerAlertCooldownMs()

  // Re-sync custom alert rules (plan 32) every sweep tick: unregisters stale
  // `custom:*` ids first, then loads whatever is currently enabled in D1.
  // This is a no-op (built-ins run unaffected) when D1 is unconfigured or the
  // load fails — see `loadCustomRulesIntoRegistry`'s own try/catch.
  await loadCustomRulesIntoRegistry()

  const rules = ruleRegistry.getAll()
  const thresholdOverrides = getServerThresholdOverrides(rules.map((r) => r.id))

  // Hysteresis config (#2767): per-check anti-flap knobs. Resolved for every
  // base + compound rule id; dispatch looks up `byRule[id] ?? defaults`
  // (compound ids fall through to defaults). Env-configured, like thresholds.
  const hysteresis = getServerHysteresisConfig([
    ...rules.map((r) => r.id),
    ...compoundRuleRegistry.getAll().map((r) => r.id),
  ])

  // Durable state (#2767): hydrate the in-memory transition/hysteresis store
  // from D1 so streaks + incident timers survive worker restarts. Best-effort —
  // a no-op with no D1 binding (the OSS default), leaving ephemeral memory.
  if (alertingEnabled) await hydrateAlertState(alertStateStore)

  // Compound rules (plan 31): order them once up front so dependency ordering
  // is computed a single time, not per host. A misconfigured compound rule
  // (cycle / unknown dependency) must never break base-rule evaluation — fall
  // back to "no compound rules" and keep going.
  let orderedCompoundRules: CompoundRuleDef[] = []
  try {
    orderedCompoundRules = topoSortCompound(
      compoundRuleRegistry.getAll(),
      rules.map((r) => r.id)
    )
  } catch (err) {
    error('[health-sweep] compound rule ordering failed', err as Error)
  }

  const configs = getClickHouseConfigs()

  // Maintenance windows: loaded once per sweep, best-effort (never throws —
  // listWindows() already degrades to [] on any D1/binding failure).
  // (verify) The sweep runs from a cron context with no signed-in session, so
  // there is no per-tenant owner to resolve here yet — OSS single-tenant
  // ('') is correct today; multi-tenant sweep scoping is a follow-up.
  const windows = await listWindows('')

  // Quiet hours: recurring time-of-day silence windows (#2662), loaded once
  // per sweep alongside maintenance windows. Same best-effort/OSS-single-tenant
  // contract — `listQuietHours` degrades to [] on any D1/binding failure.
  const quietHours = await listQuietHours('')

  // Time-window digest mode (#2663): the effective buffer window (D1 setting ›
  // env `HEALTH_ALERT_DIGEST_MINUTES`). `0` = off; in-pass grouping still runs
  // regardless. Best-effort — resolves to 0 (off) with no D1 binding.
  const digestWindowMinutes = await resolveDigestWindowMinutes(
    SWEEP_ROUTING_OWNER_ID
  )

  // Active operator ACKs (plan 29), loaded once for the whole sweep.
  // `listActiveAcks` never throws — a missing/misconfigured D1 binding
  // (self-hosted/OSS default) resolves to `[]`, so `isAcked` is false
  // everywhere and dispatch behaves exactly as before ACK existed.
  const acks = await listActiveAcks(SWEEP_ACK_OWNER_ID)

  return {
    settings,
    routes,
    pagerDutyFallbackKey,
    channels,
    channelSettings,
    alertingEnabled,
    cooldownMs,
    rules,
    thresholdOverrides,
    hysteresis,
    orderedCompoundRules,
    configs,
    windows,
    quietHours,
    digestWindowMs: digestWindowMinutes * 60_000,
    acks,
  }
}
