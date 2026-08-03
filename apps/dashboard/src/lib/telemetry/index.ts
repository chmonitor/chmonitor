// Opt-in, privacy-first product telemetry. OFF by default.
//
// Enable with CHM_TELEMETRY=on (server) or VITE_TELEMETRY_ENABLED=true (client
// build). See docs/content/advanced/telemetry.mdx for the privacy stance and
// the kill-switch.

export {
  ACTIVATION_ANY_OF,
  ACTIVATION_REQUIRED,
  isActivated,
} from './activation'
export {
  isDoNotTrack,
  isTelemetryEnabled,
  isTelemetryFlagDisabled,
} from './config'
export {
  type ChFlavor,
  type DeployTarget,
  detectChFlavor,
  getDeployTarget,
  parseMajorMinor,
} from './environment'
export {
  getEventEndpoint,
  installTelemetryEventSink,
  uninstallTelemetryEventSink,
} from './event-sink'
export {
  isTelemetryEvent,
  TELEMETRY_EVENTS,
  type TelemetryEvent,
  type TelemetryPayload,
  type TelemetryProps,
  type TelemetryPropValue,
} from './events'
export {
  buildPingPayload,
  DEFAULT_TELEMETRY_ENDPOINT,
  getPingEndpoint,
  maybePingInstance,
  PING_INTERVAL_MS,
  type PingDeps,
  type PingResult,
  runInstancePing,
  shouldPing,
} from './instance-ping'
export { isBlockedKey, looksSensitive, redactProps } from './redact'
export {
  clearTelemetrySinks,
  registerTelemetrySink,
  type TelemetrySink,
  track,
} from './track'
export { useFeatureTracking } from './use-feature-tracking'
