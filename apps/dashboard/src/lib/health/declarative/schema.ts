/**
 * Declarative health config — schema types (#3496).
 *
 * One YAML file per concern under `CHM_HEALTH_CONFIG_DIRECTORY`:
 *
 *   alerts.yaml       custom rules (`id`) + threshold overrides (rule name)
 *   routing.yaml      alert routes (`id`)
 *   channels.yaml     channel config (`channel`) + custom webhook targets (`id`)
 *   quiet-hours.yaml  quiet-hours windows (`id`)
 *   maintenance.yaml  maintenance windows (`id`)
 *   digest.yaml       digest settings (single value, key `__digest__`)
 *
 * Every keyed entry carries its merge key explicitly — the key is never
 * generated (see "The merge contract" in
 * docs/knowledge/metadata-db-optional-config.md). Unknown keys are rejected
 * (`z.strictObject`) so a typo is reported instead of silently ignored.
 *
 * Secrets never live in these files: a ConfigMap is not a Secret. Every
 * secret-bearing field is an env var NAME (`*Env`) that the merge layer
 * (#3497) resolves at read time, mirroring `HEALTH_ALERT_WEBHOOK_TARGETS`'s
 * `urlEnv` / `headersEnv` convention.
 */

import { z } from 'zod'

import type { CustomWebhookTarget } from '../custom-webhook-targets'

import { ALERT_CONFIG_CHANNELS } from '../alert-config-channels'
import {
  CUSTOM_WEBHOOK_FORMATS,
  sanitizeCustomHeaders,
} from '../custom-webhook-targets'
import {
  customRuleInputSchema,
  METRIC_CATALOG,
  type MetricKey,
} from '../rule-builder-schema'

/** The six concerns, in load order. The file name is `<concern>.yaml`. */
export const HEALTH_CONFIG_CONCERNS = [
  'alerts',
  'routing',
  'channels',
  'quiet-hours',
  'maintenance',
  'digest',
] as const

export type HealthConfigConcern = (typeof HEALTH_CONFIG_CONCERNS)[number]

/** Merge key: non-empty, bounded, no surrounding whitespace. */
const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^\S(.*\S)?$/, 'must not have leading/trailing whitespace')

/** An env var NAME that holds a secret — never the secret value itself. */
const envNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be an environment variable name')

const severityFloorSchema = z.enum(['warning', 'critical'])

/** Non-secret destination fields (chat ids, regions, to/from, …). */
const targetSchema = z.record(z.string(), z.string())

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const HM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const METRIC_KEYS = Object.keys(METRIC_CATALOG) as [MetricKey, ...MetricKey[]]

export const declarativeCustomRuleSchema = z
  .strictObject({
    id: idSchema,
    name: z.string(),
    metric: z.enum(METRIC_KEYS),
    op: z.enum(['>', '>=', '<', '<=']),
    warning: z.number(),
    critical: z.number(),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    // Reuse the UI rule-builder's validation (name bounds, finite numbers,
    // warning/critical ordering per operator) so both paths agree.
    const { id: _id, enabled: _enabled, ...input } = value
    const result = customRuleInputSchema.safeParse(input)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: issue.path,
        })
      }
    }
  })

export const declarativeThresholdSchema = z.strictObject({
  warning: z.number().finite().optional(),
  critical: z.number().finite().optional(),
})

export const declarativeRouteSchema = z.strictObject({
  id: idSchema,
  /** Rule id, rule type, or `*`; may be a glob. */
  matchRule: z.string().min(1).default('*'),
  /** Host id, host name, or `*`; may be a glob. */
  matchHost: z.string().min(1).default('*'),
  provider: z.enum(['webhook', 'pagerduty', 'telegram', 'ntfy', 'pushover']),
  enabled: z.boolean().default(true),
  minSeverity: severityFloorSchema.nullable().default(null),
  target: targetSchema.default({}),
  /** Env var holding the route's secret (webhook URL, routing key, token). */
  secretEnv: envNameSchema.optional(),
})

export const declarativeChannelSchema = z.strictObject({
  channel: z.enum(ALERT_CONFIG_CHANNELS),
  enabled: z.boolean().default(true),
  minSeverity: severityFloorSchema.nullable().default(null),
  target: targetSchema.default({}),
  /** Env var holding the channel's single secret. */
  secretEnv: envNameSchema.optional(),
})

export const declarativeWebhookTargetSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  format: z.enum(CUSTOM_WEBHOOK_FORMATS).default('auto'),
  minSeverity: severityFloorSchema.nullable().default(null),
  titleTemplate: z.string().max(200).default(''),
  bodyTemplate: z.string().max(2000).default(''),
  /** `X-*` only, capped — the same rules as the UI and env paths. */
  headers: z
    .record(z.string(), z.string())
    .default({})
    .superRefine((headers, ctx) => {
      const { dropped } = sanitizeCustomHeaders(headers)
      if (dropped.length > 0) {
        // Header names only — values may be sensitive.
        ctx.addIssue({
          code: 'custom',
          message: `rejected headers: ${dropped.join(', ')}`,
        })
      }
    }),
  /** Env var holding the HTTPS webhook URL (credential-bearing). */
  urlEnv: envNameSchema,
  /** Env var holding a JSON object of secret headers. */
  headersEnv: envNameSchema.optional(),
})

export const declarativeQuietHoursSchema = z.strictObject({
  id: idSchema,
  days: z.array(z.number().int().min(0).max(6)).min(1),
  start: z.string().regex(HM_PATTERN, 'must be HH:mm'),
  end: z.string().regex(HM_PATTERN, 'must be HH:mm'),
  timezone: z
    .string()
    .min(1)
    .default('UTC')
    .refine(isValidTimeZone, 'must be an IANA timezone'),
  severityCap: z.literal('critical').nullable().default(null),
})

export const declarativeMaintenanceWindowSchema = z
  .strictObject({
    id: idSchema,
    /** `null`/omitted = all hosts. */
    hostId: z.number().int().min(0).nullable().default(null),
    reason: z.string().default(''),
    /** ISO-8601 timestamp. */
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine((w) => Date.parse(w.endsAt) > Date.parse(w.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })

export const declarativeDigestSchema = z.strictObject({
  enabled: z.boolean(),
  windowMinutes: z.number().int().min(0).max(1440),
})

export type DeclarativeCustomRule = z.infer<typeof declarativeCustomRuleSchema>
export type DeclarativeThreshold = z.infer<typeof declarativeThresholdSchema>
export type DeclarativeRoute = z.infer<typeof declarativeRouteSchema>
export type DeclarativeChannel = z.infer<typeof declarativeChannelSchema>
export type DeclarativeWebhookTarget = z.infer<
  typeof declarativeWebhookTargetSchema
>
export type DeclarativeQuietHours = z.infer<typeof declarativeQuietHoursSchema>
export type DeclarativeMaintenanceWindow = z.infer<
  typeof declarativeMaintenanceWindowSchema
>
export type DeclarativeDigest = z.infer<typeof declarativeDigestSchema>

// ---------------------------------------------------------------------------
// Files: top-level shape per concern. Lists are validated entry-by-entry by
// the loader, so one bad entry does not drop its siblings.
// ---------------------------------------------------------------------------

const list = z.array(z.unknown()).default([])

export const HEALTH_CONFIG_FILE_SCHEMAS = {
  alerts: z.strictObject({
    rules: list,
    thresholds: z.record(z.string(), z.unknown()).default({}),
  }),
  routing: z.strictObject({ routes: list }),
  channels: z.strictObject({ channels: list, webhookTargets: list }),
  'quiet-hours': z.strictObject({ windows: list }),
  maintenance: z.strictObject({ windows: list }),
  digest: declarativeDigestSchema,
} as const satisfies Record<HealthConfigConcern, z.ZodType>

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * One source's contribution. Every field is keyed by its merge key so the
 * merge helper (#3497) can union across layers without re-deriving keys.
 * An absent key means "this source says nothing", never "delete".
 */
export interface HealthConfigData {
  customRules: Record<string, DeclarativeCustomRule>
  /** Keyed by rule name (the `ThresholdsMap` key). */
  thresholds: Record<string, DeclarativeThreshold>
  routes: Record<string, DeclarativeRoute>
  /** Keyed by channel name. */
  channels: Record<string, DeclarativeChannel>
  webhookTargets: Record<string, DeclarativeWebhookTarget>
  quietHours: Record<string, DeclarativeQuietHours>
  maintenanceWindows: Record<string, DeclarativeMaintenanceWindow>
  /** Single value (merge key `__digest__`); `undefined` = not set here. */
  digest?: DeclarativeDigest
}

/**
 * Env-sourced webhook targets are already resolved by
 * `loadEnvCustomWebhookTargets` (URL and secret headers included), so the env
 * layer carries that runtime shape rather than the `*Env` reference shape.
 */
export type HealthConfigEnvData = Omit<HealthConfigData, 'webhookTargets'> & {
  webhookTargets: Record<string, CustomWebhookTarget>
}

/** Sources, lowest precedence first. `d1` is layered on by #3497. */
export type HealthConfigSource = 'env' | 'file'

export type HealthConfigLayer =
  | { source: 'env'; data: HealthConfigEnvData }
  | { source: 'file'; directory: string; data: HealthConfigData }

export interface HealthConfigSkip {
  file: string
  /** Where inside the file, e.g. `routes[2]`; absent for whole-file skips. */
  entry?: string
  error: string
}

export function emptyHealthConfigData(): HealthConfigData {
  return {
    customRules: {},
    thresholds: {},
    routes: {},
    channels: {},
    webhookTargets: {},
    quietHours: {},
    maintenanceWindows: {},
  }
}
