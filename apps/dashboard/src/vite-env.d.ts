/// <reference types="vite/client" />

// Client-exposed env vars MUST be VITE_-prefixed — Vite inlines import.meta.env
// at build time (the Next app's NEXT_PUBLIC_* equivalent). Add new public vars
// here so they are typed wherever import.meta.env is read.
interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  readonly VITE_FEATURE_CONVERSATION_DB?: string
  readonly VITE_FEATURE_USER_CONNECTIONS_DB?: string
  // Outbound webhook subscriptions (plan 44). See lib/events/server-feature.ts.
  readonly VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS?: string
  readonly VITE_AUTOCOMPLETE_LIMIT?: string
  readonly VITE_RUNNING_QUERIES_REFRESH_MS?: string
  // Opt-in product telemetry (off by default). See lib/telemetry/.
  readonly VITE_TELEMETRY_ENABLED?: string
  // Deployment target for telemetry dimensions (docker | helm | cf | dev | unknown).
  readonly VITE_DEPLOY_TARGET?: string
  // Collection endpoint for the daily instance ping. Empty = no-op.
  readonly VITE_TELEMETRY_ENDPOINT?: string
  // DO_NOT_TRACK opt-out (https://consoledonottrack.com). Any truthy value
  // forces telemetry off regardless of VITE_TELEMETRY_ENABLED.
  readonly VITE_DO_NOT_TRACK?: string
  // Build metadata (injected by vite.config define / CI build step)
  readonly VITE_GIT_SHA?: string
  readonly VITE_GIT_REF?: string
  readonly VITE_BUILD_TIMESTAMP?: string
  readonly VITE_CI?: string
  // Query-config source flag. 'ts' = current TS configs (default); 'declarative'
  // = load from external declarative catalog. See lib/query-config/declarative/loader.ts.
  readonly VITE_CONFIG_SOURCE?: string
  // Edition flag. 'community' (default, OSS, fail-open) | 'enterprise' (paid).
  // See lib/edition/. Unset or unrecognised → 'community'.
  readonly VITE_EDITION?: string
  // Cloud (SaaS) mode. 'true' on dash.chmonitor.dev; unset/junk → self-hosted.
  // See lib/cloud/cloud-mode.ts. When on, env hosts are a public read-only demo.
  readonly VITE_CLOUD_MODE?: string
  // Deployment profile — the single high-level switch. 'cloud' | 'oss'.
  // See lib/config/deployment-mode.ts. Drives the defaults for cloud mode, auth provider,
  // public-read, and per-user storage. The VITE_*/CHM_* vars above override it.
  readonly VITE_DEPLOYMENT_MODE?: string
  // Product analytics (PostHog). OFF unless set — see lib/analytics/. Distinct
  // from VITE_TELEMETRY_ENABLED (anonymous OSS instance telemetry).
  readonly VITE_ANALYTICS_KEY?: string
  // Self-hosted PostHog host override. Empty = PostHog Cloud (US) default.
  readonly VITE_ANALYTICS_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
