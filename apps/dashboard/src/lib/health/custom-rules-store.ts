/**
 * D1-backed store for custom alert rules (plan 32). Mirrors
 * `lib/events/subscription-store.ts`'s conventions: same `CHM_CLOUD_D1`
 * binding, same `crypto.randomUUID()`-derived ids, same
 * `WHERE owner_id = ? AND id = ?`-guarded mutations so one owner can never
 * read, delete, or accidentally collide with another owner's rule.
 *
 * The same table also holds built-in check alerts (#3438): rows with
 * `check_id` set and no metric/op/thresholds, owned by `check-alerts-store.ts`.
 * Every query here filters `check_id IS NULL`, so those rows never reach the
 * rule builder, alert suggestions, the sweep registry, or the DELETE route.
 *
 * Only `metric` (a catalog key), `op`, `name`, and the numeric thresholds are
 * persisted — never SQL. The SQL is always re-derived from
 * `METRIC_CATALOG` via `compileCustomRule` at read time (sweep + "test"),
 * so a future catalog change (or removal) also updates/invalidates every
 * existing rule instead of leaving stale SQL behind.
 */

import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { Sourced, SourceLayer } from './declarative/merge'
import type { CustomRuleInput } from './rule-builder-schema'
import type { HealthSqlDb } from './sql-db'

import { mergeSources } from './declarative/merge'
import { readHealthConfigLayers } from './declarative/sources'
import { getHealthDb } from './resolve-store'
import { compileCustomRule, customRuleInputSchema } from './rule-builder-schema'
import { debug } from '@chm/logger'

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

/**
 * The resolved backend (D1 → Postgres), or `NOT_CONFIGURED` when there is none.
 *
 * Writes always throw without a DB (the POST/DELETE routes map it to 501). The
 * read path is normalised to its siblings (#3497): {@link listCustomRules}
 * returns the declarative rules when there is no DB, and throws
 * `NOT_CONFIGURED` only when there is no DB AND no declarative rule — that
 * 501 is the signal `RuleBuilderPanel` renders as "not available on this
 * deployment", so an empty list never shows a form whose save then fails.
 */
function getDb(): HealthSqlDb {
  const db = getHealthDb()
  if (!db) {
    throw new CustomRuleStoreError(
      'No alert state backend configured. Custom alert rules require a D1 binding (CHM_CLOUD_D1) or a Postgres DATABASE_URL.',
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

/**
 * List every custom rule visible to `ownerId`: the DB rows merged with the
 * declarative `alerts.yaml` rules (#3497) — union by id (declarative ids are
 * `custom:<id>`), the DB row winning field by field. Throws `NOT_CONFIGURED`
 * only when there is neither a DB nor a declarative rule; a DB read failure
 * with declarative rules present still throws `STORAGE_ERROR`, so a broken
 * table is reported rather than hidden behind the file's rules.
 */
export async function listCustomRules(
  ownerId: string
): Promise<Sourced<CustomAlertRule>[]> {
  const declared = await declarativeCustomRules(ownerId)
  const hasDeclared = declared.some((layer) => layer.entries.length > 0)
  if (!getHealthDb() && hasDeclared) {
    return mergeSources(declared, (rule) => rule.id, 'union')
  }
  const rows = await listDbCustomRules(ownerId)
  return mergeSources(
    [...declared, { source: 'd1', entries: rows }],
    (rule) => rule.id,
    'union'
  )
}

/** The DB rows only; throws `NOT_CONFIGURED` / `STORAGE_ERROR`. */
async function listDbCustomRules(ownerId: string): Promise<CustomAlertRule[]> {
  try {
    const db = getDb()
    const result = await db
      .prepare(
        `SELECT id, owner_id, name, metric, op, warning, critical, enabled, created_at
         FROM custom_alert_rules
         WHERE owner_id = ?1 AND check_id IS NULL
         ORDER BY created_at DESC`
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

/**
 * Ownership-guarded DELETE. `check_id IS NULL` keeps a built-in check alert
 * row (#3438) out of reach of the custom-rules route: those are reset through
 * `check-alerts-store.ts`, never deleted as a custom rule.
 */
export const D1_DELETE_CUSTOM_RULE_SQL = `DELETE FROM custom_alert_rules WHERE id = ?1 AND owner_id = ?2 AND check_id IS NULL`

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
 *
 * Declarative rules (#3497) are merged in by id and always load: a missing or
 * failing DB contributes no rows (logged), it never drops the file's rules.
 * Merging happens BEFORE the enabled filter, so a DB row can disable a
 * declarative rule and a file can disable nothing it does not define.
 */
async function listAllEnabledCustomRules(): Promise<CustomAlertRule[]> {
  const declared = await declarativeCustomRules('')
  const hasDeclared = declared.some((layer) => layer.entries.length > 0)
  let rows: CustomAlertRule[] = []
  try {
    const db = getHealthDb()
    if (db) {
      // Disabled rows only matter when they can shadow a declarative rule;
      // a DB-only deploy keeps reading just the enabled ones.
      const result = await db
        .prepare(
          `SELECT id, owner_id, name, metric, op, warning, critical, enabled, created_at
           FROM custom_alert_rules
           WHERE check_id IS NULL${hasDeclared ? '' : ' AND enabled = 1'}`
        )
        .all<D1CustomRuleRow>()
      rows = (result.results || []).map(rowToRule)
    }
  } catch (err) {
    debug(
      '[custom-rules-store] failed to read custom alert rules from the DB; declarative rules only',
      err instanceof Error ? err.message : String(err)
    )
  }
  const merged = mergeSources(
    [...declared, { source: 'd1', entries: rows }],
    (rule) => rule.id,
    'union'
  )
  return merged.filter((rule) => rule.enabled)
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

// ---------------------------------------------------------------------------
// Declarative reader: Custom rules — merge key `id`, normalised to `custom:<id>`
// ---------------------------------------------------------------------------

/**
 * The registry's id for a declarative rule. `custom:` keeps it out of the
 * built-in rule namespace and inside the sweep's `custom:*` unregister pass.
 */
function toCustomRuleId(id: string): string {
  return id.startsWith('custom:') ? id : `custom:${id}`
}

async function declarativeCustomRules(
  ownerId: string
): Promise<SourceLayer<CustomAlertRule>[]> {
  return (await readHealthConfigLayers()).map((layer) => ({
    source: layer.source,
    entries: Object.values(layer.data.customRules).map((rule) => ({
      id: toCustomRuleId(rule.id),
      ownerId,
      name: rule.name,
      metric: rule.metric,
      op: rule.op,
      warning: rule.warning,
      critical: rule.critical,
      enabled: rule.enabled,
      createdAt: 0,
    })),
  }))
}
