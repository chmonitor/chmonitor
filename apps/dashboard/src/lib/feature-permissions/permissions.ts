import type { FeaturePermission } from './types'

export const AGENT_FEATURE_PERMISSION = {
  feature: 'agent',
  // The AI agent runs queries and (with control tools) mutates the cluster — a
  // write. defaultAccess keeps the existing frontend gate (AgentAuthGate keys
  // off access === 'authenticated'); operation classifies it on the read/write
  // axis so anonymous read-only deployments cannot drive the agent.
  defaultAccess: 'authenticated',
  operation: 'write',
} satisfies FeaturePermission

export const ACTIONS_FEATURE_PERMISSION = {
  feature: 'actions',
  // Mutating control actions (KILL QUERY, OPTIMIZE TABLE) — a write.
  defaultAccess: 'authenticated',
  operation: 'write',
} satisfies FeaturePermission

export const TABLES_FEATURE_PERMISSION = {
  feature: 'tables',
} satisfies FeaturePermission

// Health remediation actions (POST /api/v1/health/actions). Even a read-only
// diagnostic still issues an on-demand cluster call, so it is gated like the
// other mutating health routes (mirrors health/webhook.ts) rather than the
// plain 'health' read feature.
export const HEALTH_ACTIONS_FEATURE_PERMISSION = {
  feature: 'health',
  defaultAccess: 'authenticated',
  operation: 'write',
} satisfies FeaturePermission

// Arbitrary user-supplied SQL execution (SQL Console, explorer query tab).
// Same `tables` feature as schema browsing, but classified as a write: running
// attacker-chosen SQL is a powerful capability distinct from a fixed registry
// query, so anonymous read-only callers must not reach it.
export const EXPLORER_QUERY_FEATURE_PERMISSION = {
  feature: 'tables',
  operation: 'write',
} satisfies FeaturePermission

export const OVERVIEW_FEATURE_PERMISSION = {
  feature: 'overview',
} satisfies FeaturePermission

export const SETTINGS_FEATURE_PERMISSION = {
  feature: 'settings',
} satisfies FeaturePermission

export const CLUSTER_FEATURE_PERMISSION = {
  feature: 'cluster',
} satisfies FeaturePermission

export const PEERDB_FEATURE_PERMISSION = {
  feature: 'peerdb',
} satisfies FeaturePermission
