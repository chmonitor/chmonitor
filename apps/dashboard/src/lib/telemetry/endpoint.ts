// The one default collection endpoint for the dashboard's telemetry: the shared
// telemetry service, project `chmonitor`. The instance ping and the event sink
// both POST here (one event or an array), so there is no per-kind path.
//
// Kept in its own dependency-free module so vite.config.ts can import it too:
// the client bundle inlines VITE_TELEMETRY_ENDPOINT, and a second copy of this
// URL there would let the browser keep posting to the old host.
//
// Overridable via CHM_TELEMETRY_ENDPOINT (server) / VITE_TELEMETRY_ENDPOINT
// (client build). An empty string is the hard no-network kill-switch.
export const DEFAULT_TELEMETRY_ENDPOINT =
  'https://telemetry.anyr.workers.dev/chmonitor'
