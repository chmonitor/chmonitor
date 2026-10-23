/**
 * Optimization plan (#4071): a ranked, recommend-only list of changes built
 * from the findings the advisors already persisted.
 *
 * Nothing in a plan is ever applied. `notApplied: true` is a literal so no code
 * path can produce a plan that claims otherwise. Byte and time figures are
 * nullable: the findings store keeps one scalar per finding, and a ratio or a
 * count is never converted into bytes.
 */

import { z } from 'zod'

export const PLAN_SOURCES = [
  'usage',
  'codec',
  'ttl',
  'detached',
  'settings',
] as const
export type PlanSource = (typeof PLAN_SOURCES)[number]

export const PLAN_RISKS = ['low', 'medium', 'high'] as const
export type PlanRisk = (typeof PLAN_RISKS)[number]

/** Default rewrite throughput for `estHours`, in MB/s (design default 2). */
export const DEFAULT_REWRITE_MBPS = 50

const bytes = z.number().nonnegative().nullable()

export const applyCostSchema = z.object({
  kind: z.enum(['none', 'metadata', 'mutation', 'optimize']),
  /** Bytes a mutation or merge rewrites; null when not measured. */
  rewriteBytes: bytes,
  freeDiskNeeded: bytes,
  estHours: z.number().nonnegative().nullable(),
})
export type ApplyCost = z.infer<typeof applyCostSchema>

export const planItemSchema = z.object({
  rank: z.number().int().positive(),
  id: z.string().min(1),
  title: z.string().min(1),
  /** Database name; null when the finding names no table. */
  owner: z.string().nullable(),
  source: z.enum(PLAN_SOURCES),
  savedBytes: bytes,
  readBytesSavedPerDay: bytes,
  applyCost: applyCostSchema,
  risk: z.enum(PLAN_RISKS),
  reversible: z.boolean(),
  /** Statements to review and copy, in apply order. Empty for a review item. */
  ddl: z.array(z.string()),
  verifySql: z.string(),
  rollbackSql: z.string().optional(),
  dependsOn: z.array(z.string()),
  evidenceSql: z.string(),
  /** The finding text the item came from, shown as data. */
  evidence: z.string(),
  needsOwnerApproval: z.boolean(),
})
export type PlanItem = z.infer<typeof planItemSchema>

/** A plan item before ranking: `rank` is assigned by the ranker. */
export type PlanCandidate = Omit<PlanItem, 'rank'>

export const skippedCollectorSchema = z.object({
  collector: z.string(),
  reason: z.string(),
})
export type SkippedCollector = z.infer<typeof skippedCollectorSchema>

export const rejectedItemSchema = z.object({
  item: planItemSchema.omit({ rank: true }),
  reason: z.string(),
})
export type RejectedItem = z.infer<typeof rejectedItemSchema>

export const planSchema = z.object({
  notApplied: z.literal(true),
  hostId: z.number().int(),
  generatedAt: z.string(),
  /** Window of persisted findings the plan was built from. */
  findingsSince: z.string(),
  rewriteMBps: z.number().positive(),
  collectorsRan: z.array(z.string()),
  items: z.array(planItemSchema),
  skipped: z.array(skippedCollectorSchema),
  testedAndRejected: z.array(rejectedItemSchema),
})
export type Plan = z.infer<typeof planSchema>

export const NOT_APPLIED_BANNER =
  'NOT APPLIED: copy and review; chmonitor never runs these statements.'
