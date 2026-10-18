// Telemetry enablement gate. ON by default — anonymous, privacy-first product
// telemetry runs unless the user explicitly turns it off. Opting out is always
// honored and always wins.
//
// Dual-source, mirroring lib/env.ts so the on/off semantics survive both the
// Node and the Cloudflare Worker runtime:
//   - Server: runtime CHM_TELEMETRY (Worker binding / process.env).
//   - Client: build-time VITE_TELEMETRY_ENABLED (inlined by vite.config.ts).
//
// Toggle OFF with CHM_TELEMETRY=off (also `0`/`false`/`no`). `on`/`true`/`1`/
// `yes`, an unrecognised value, or unset all keep telemetry ON.
//
// Opt-out also honors the cross-tool DO_NOT_TRACK standard
// (https://consoledonottrack.com) as a HARD override: any truthy DO_NOT_TRACK
// turns telemetry off regardless of CHM_TELEMETRY. Server reads DO_NOT_TRACK;
// the client build mirrors it as VITE_DO_NOT_TRACK.
//
// Note: even when enabled, the instance ping makes ZERO network calls unless a
// collection endpoint is resolved (see instance-ping.ts). Setting the endpoint
// env to an empty string is therefore an additional hard kill-switch.

// Values that explicitly turn telemetry OFF. Anything else (including unset or
// an unrecognised value) leaves it ON.
const DISABLED_VALUES = new Set(['off', '0', 'false', 'no'])
// DO_NOT_TRACK is treated as opt-out unless explicitly disabled. Only these
// values mean "tracking allowed"; anything else that is set opts out.
const DNT_DISABLED_VALUES = new Set(['0', 'false', 'no', ''])

export function isTelemetryFlagDisabled(
  value: string | null | undefined
): boolean {
  if (value == null) return false
  return DISABLED_VALUES.has(value.trim().toLowerCase())
}

/**
 * Returns true when the DO_NOT_TRACK opt-out is active. Per the DNT convention
 * any set, non-"0"/"false"/"no" value means opt out; unset means no preference.
 */
export function isDoNotTrack(value: string | null | undefined): boolean {
  if (value == null) return false
  return !DNT_DISABLED_VALUES.has(value.trim().toLowerCase())
}

export function isTelemetryEnabled(
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  // Hard opt-out wins over everything.
  if (isDoNotTrack(source.DO_NOT_TRACK ?? import.meta.env.VITE_DO_NOT_TRACK)) {
    return false
  }
  return !isTelemetryFlagDisabled(
    source.CHM_TELEMETRY ?? import.meta.env.VITE_TELEMETRY_ENABLED
  )
}
