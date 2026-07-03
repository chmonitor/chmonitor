/**
 * D1-backed store for custom alert rules (plan 32). Mirrors
 * `lib/events/subscription-store.ts`'s conventions: same `CHM_CLOUD_D1`
 * binding, same `crypto.randomUUID()`-derived ids, same
 * `WHERE owner_id = ? AND id = ?`-guarded mutations so one owner can never
 * read, delete, or accidentally collide with another owner's rule.
 *
 * Only `metric` (a catalog key), `op`, `name`, and the numeric thresholds are
 * persisted — never SQL. The SQL is always re-derived from
 * `METRIC_CATALOG` via `compileCustomRule` at read time (sweep + "test"),
 * so a future catalog change (or removal) also updates/invalidates every
 * existing rule instead of leaving stale SQL behind.
 */

import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { CustomRuleInput } from './rule-builder-schema'

import { compileCustomRule, customRuleInputSchema } from './rule-builder-schema'
import { debug } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

export interface CustomAlertRule {
  id: string
  ownerId: string
  name: string
  metric: string
  op: string
  warning: number
  critical: number
  enabled: boolean
  createdAt: number
}

export class CustomRuleStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'NOT_CONFIGURED' | 'STORAGE_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CustomRuleStoreError'
  }
}

interface D1CustomRuleRow {
  id: string
  owner_id: string
  name: string
  metric: string
  op: string
  warning: number
  critical: number
  enabled: number
  created_at: number
}

function getDb(): D1Database {
  const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
  if (!db) {
    throw new CustomRuleStoreError(
      `${D1_BINDING_NAME} binding not found. Ensure D1 database is configured in wrangler.toml`,
      'NOT_CONFIGURED'
    )
  }
  return db
}

function rowToRule(row: D1CustomRuleRow): CustomAlertRule {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    metric: row.metric,
    op: row.op,
    warning: row.warning,
    critical: row.critical,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  }
}

/** List every custom rule owned by `ownerId`. */
export async function listCustomRules(
  ownerId: string
): Promise<CustomAlertRule[]> {
  try {
    const db = getDb()
    const result = await db
      .prepare(
        `SELECT id, owner_id, name, metric, op, warning, critical, enabled, created_at
         FROM custom_alert_rules WHERE owner_id = ?1 ORDER BY created_at DESC`
      )
      .bind(ownerId)
      .all<D1CustomRuleRow>()
    return (result.results || []).map(rowToRule)
  } catch (err) {
    if (err instanceof CustomRuleStoreError) throw err
    throw new CustomRuleStoreError(
      `Failed to list custom alert rules: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      err
    )
  }
}

/**
 * Create a custom rule. Validates + compiles the input first (rejects
 * off-catalog metrics / non-numeric thresholds / non-read-only SQL) BEFORE
 * touching D1 — no invalid row is ever persisted.
 */
export async function createCustomRule(
  ownerId: string,
  input: CustomRuleInput
): Promise<CustomAlertRule> {
  // Validate + compile (throws ZodError / Error on invalid input, including
  // the read-only SQL deny-list check — see rule-builder-schema.ts).
  const parsed = customRuleInputSchema.parse(input)
  compileCustomRule(parsed)

  const db = getDb()
  const now = Date.now()
  const id = `custom:${crypto.randomUUID()}`

  try {
    await db
      .prepare(
        `INSERT INTO custom_alert_rules
           (id, owner_id, name, metric, op, warning, critical, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)`
      )
      .bind(
        id,
        ownerId,
        parsed.name,
        parsed.metric,
        parsed.op,
        parsed.warning,
        parsed.critical,
        now
      )
      .run()
  } catch (err) {
    throw new CustomRuleStoreError(
      `Failed to create custom alert rule: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      err
    )
  }

  return {
    id,
    ownerId,
    name: parsed.name,
    metric: parsed.metric,
    op: parsed.op,
    warning: parsed.warning,
    critical: parsed.critical,
    enabled: true,
    createdAt: now,
  }
}

/** Ownership-guarded DELETE. */
export const D1_DELETE_CUSTOM_RULE_SQL = `DELETE FROM custom_alert_rules WHERE id = ?1 AND owner_id = ?2`

export async function deleteCustomRule(
  ownerId: string,
  id: string
): Promise<void> {
  const db = getDb()
  let changes: number
  try {
    const result = await db
      .prepare(D1_DELETE_CUSTOM_RULE_SQL)
      .bind(id, ownerId)
      .run()
    changes = result.meta.changes ?? 0
  } catch (err) {
    throw new CustomRuleStoreError(
      `Failed to delete custom alert rule: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      err
    )
  }

  if (changes === 0) {
    throw new CustomRuleStoreError('Custom alert rule not found', 'NOT_FOUND')
  }
}

/**
 * All enabled custom rules across every owner. The cron sweep is a single
 * global process (not scoped to a signed-in visitor) — it mirrors how
 * `HEALTH_ALERT_WEBHOOK_URL` is a single env-wide destination today. True
 * per-owner alert routing in a multi-tenant cloud deployment is a documented
 * follow-up (plan 32 open question 3), not attempted here.
 */
async function listAllEnabledCustomRules(): Promise<CustomAlertRule[]> {
  const db = getDb()
  const result = await db
    .prepare(
      `SELECT id, owner_id, name, metric, op, warning, critical, enabled, created_at
       FROM custom_alert_rules WHERE enabled = 1`
    )
    .all<D1CustomRuleRow>()
  return (result.results || []).map(rowToRule)
}

/**
 * Re-sync the registry's `custom:*` rules from D1: unregister every
 * previously-loaded custom rule id first (so a deleted/disabled/renamed rule
 * never lingers), then compile + register each currently-enabled row.
 *
 * Fails OPEN: any error (no D1 binding, no CHM_CLOUD_D1, query failure) is
 * swallowed — zero custom rules load, built-ins run unaffected, the sweep
 * never crashes. A single malformed row (e.g. a metric later removed from
 * the catalog) is skipped rather than aborting the whole sync.
 */
export async function loadCustomRulesIntoRegistry(): Promise<void> {
  // Import lazily to avoid a require-cycle risk between this store and the
  // registry module (both are leaf-ish, but this keeps the dependency clear).
  const { ruleRegistry } = await import('@/lib/alerting/rule-registry')
  const { assertReadOnlySql } = await import('./rule-builder-schema')

  for (const rule of ruleRegistry.getAll()) {
    if (rule.id.startsWith('custom:')) {
      ruleRegistry.unregister(rule.id)
    }
  }

  let rows: CustomAlertRule[]
  try {
    rows = await listAllEnabledCustomRules()
  } catch (err) {
    debug(
      '[custom-rules-store] failed to load custom alert rules; built-ins only',
      err instanceof Error ? err.message : String(err)
    )
    return
  }

  for (const row of rows) {
    try {
      const compiled: AlertRuleDef = compileCustomRule({
        name: row.name,
        metric: row.metric as CustomRuleInput['metric'],
        op: row.op as CustomRuleInput['op'],
        warning: row.warning,
        critical: row.critical,
      })
      // Persist-time and register-time are both deny-list-checked per plan
      // 32's STOP conditions; compileCustomRule already checked once.
      if (compiled.sql) assertReadOnlySql(compiled.sql)
      // Re-key the compiled rule to the stored row id so unregister/delete
      // by id is stable across sweeps (compileCustomRule mints a fresh id
      // otherwise, since it doesn't know about persisted rows).
      ruleRegistry.register({ ...compiled, id: row.id })
    } catch (err) {
      debug(
        `[custom-rules-store] skipping invalid custom rule "${row.id}"`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
