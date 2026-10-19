/**
 * The static PeerDB alert rule ids, and the policy for their per-rule env
 * overrides (#4029).
 *
 * The PeerDB cycle (`./alert-cycle`) dispatches ids that are NOT in the alert
 * rule registry the sweep resolves hysteresis/cooldown for, so
 * `HEALTH_HYSTERESIS_<RULE_ID>_BREACHES` and
 * `HEALTH_ALERT_COOLDOWN_<RULE_ID>_MINUTES` used to be silently ignored for
 * them. The sweep resolves them by importing this list into
 * `health/sweep/resolve-config.ts`.
 *
 * A leaf module (no imports) for the same reason `flow-slug.ts` is one: the
 * sweep resolves its context on every tick and must not pull the alert cycle,
 * its collector, or the D1-backed stores in to learn three string constants.
 *
 * ## Parameterised ids and the static-prefix policy
 *
 * Two of the three ids are PARAMETERISED at dispatch time:
 *
 *   peerdb-mirror-health:<flow-slug>       one per mirror
 *   peerdb-log-pattern:<fingerprint-hash>  one per ERROR-log pattern
 *
 * An env var name cannot contain a colon, so there is no per-mirror env var.
 * The operator-facing knob is therefore the STATIC BASE, which applies to every
 * parameter of that rule — `HEALTH_HYSTERESIS_PEERDB_MIRROR_HEALTH_BREACHES=3`
 * debounces all mirrors, `HEALTH_ALERT_COOLDOWN_PEERDB_API_HEALTH_MINUTES=30`
 * throttles the fleet-level API probe. `perRuleEnvBaseId` in
 * `health/server-alert-config.ts` performs the lookup with that fallback;
 * muting is unaffected and still matches the full id as a glob.
 */

export const PEERDB_API_HEALTH_RULE_ID = 'peerdb-api-health'
export const PEERDB_ALERT_RULE_ID = 'peerdb-mirror-health'
export const PEERDB_LOG_PATTERN_RULE_ID = 'peerdb-log-pattern'

/** Every static PeerDB rule id the sweep resolves per-rule settings for. */
export const PEERDB_ALERT_RULE_IDS: readonly string[] = [
  PEERDB_API_HEALTH_RULE_ID,
  PEERDB_ALERT_RULE_ID,
  PEERDB_LOG_PATTERN_RULE_ID,
]
