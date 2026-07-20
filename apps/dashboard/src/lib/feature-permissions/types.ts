export const FEATURE_ACCESS_VALUES = ['public', 'authenticated'] as const

export type FeatureAccess = (typeof FEATURE_ACCESS_VALUES)[number]

export const FEATURE_IDS = [
  'overview',
  'agent',
  'insights',
  'health',
  'queries',
  'tables',
  'metrics',
  'dashboard',
  'security',
  'logs',
  'settings',
  'billing',
  'cluster',
  'operations',
  'actions',
  'mcp',
  'peerdb',
  'docs',
  'about',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]

export const FEATURE_OPERATIONS = ['read', 'write'] as const

export type FeatureOperation = (typeof FEATURE_OPERATIONS)[number]

export interface FeaturePermission {
  feature: FeatureId
  /**
   * Default access when no operator config overrides this feature.
   *
   * @default public
   */
  defaultAccess?: FeatureAccess
  /**
   * Whether this call site READS data or WRITES (mutates the cluster, runs the
   * AI agent, or executes arbitrary user-supplied SQL). Anonymous callers are
   * allowed reads only when the deployment grants anonymous read
   * (`CHM_CLERK_PUBLIC_READ` under clerk, or `auth=none`); writes always require
   * an authenticated caller. The same feature can be referenced by both a read
   * permission (e.g. schema browsing) and a write permission (arbitrary query).
   *
   * @default read
   */
  operation?: FeatureOperation
}

/**
 * What an ANONYMOUS (unauthenticated) caller may do, derived from the auth
 * provider and `CHM_CLERK_PUBLIC_READ`. Authenticated callers can always do
 * both. Principal-independent, so it is safe to expose in the public config.
 */
export interface AnonymousCapabilities {
  read: boolean
  write: boolean
}

export interface FeatureOverride {
  enabled?: boolean
  access?: FeatureAccess
}

export interface FeatureState {
  enabled: boolean
  access: FeatureAccess
}

export type FeatureOverrides = Partial<Record<FeatureId, FeatureOverride>>

export type Principal = 'anonymous' | 'authenticated'

export type ResolvedFeatureStates = Record<FeatureId, FeatureState>

export interface UserConnectionsPublicConfig {
  dbStorageEnabled: boolean
  requiresAuth: boolean
}

/**
 * Whether this deployment has a metadata database (D1 binding or a Postgres
 * `DATABASE_URL`/`POSTGRES_URL`) for persisting app state — report
 * subscriptions, per-user connections, shared dashboards. OSS deployments
 * without one keep the UI surface intact but dim the menu items that need it.
 */
export interface MetadataDbPublicConfig {
  available: boolean
}

export interface PublicFeaturePermissionConfig {
  authProvider: 'none' | 'clerk' | 'proxy' | 'trusted'
  principal: Principal
  features: FeatureOverrides
  resolved?: ResolvedFeatureStates
  /** What anonymous callers may do under this deployment's auth posture. */
  capabilities?: AnonymousCapabilities
  /** Per-user ClickHouse connection storage capabilities. */
  userConnections?: UserConnectionsPublicConfig
  /** Metadata-database availability for state-persisting features. */
  metadataDb?: MetadataDbPublicConfig
}
