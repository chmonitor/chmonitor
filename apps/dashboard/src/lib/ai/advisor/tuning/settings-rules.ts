/**
 * Advisor auto fine-tune engine — settings tuning rules.
 *
 * Pure functions over the gathered `SettingRow[]` (from `system.settings` and
 * `system.merge_tree_settings`). Each entry in `SETTINGS_RULES` inspects a
 * single setting's current value and, when it looks risky or suboptimal vs its
 * default, emits a recommend-only `TuningFinding` with rationale and a
 * ready-to-review `SET` / `ALTER TABLE ... MODIFY SETTING` statement (never
 * executed).
 *
 * These are deliberately conservative, evidence-backed rules — each fires only
 * on a concrete value pattern, never "this differs from default, therefore
 * wrong". Settings findings have no bytes figure; they rank by severity.
 */

import type { SettingRow, TuningFinding } from './types'

function toNumber(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

interface SettingRule {
  name: string
  source: SettingRow['source']
  /** Returns a finding when the rule fires, else null. */
  check: (
    row: SettingRow
  ) => Omit<
    TuningFinding,
    'ruleId' | 'category' | 'target' | 'estimatedBytesSaved'
  > | null
}

/** Build the recommend-only statement for a server (profile) setting. */
function serverSettingDdl(name: string, value: string): string {
  return `-- Session scope (review, then run in your session or set on the profile):\nSET ${name} = ${value};\n-- Persist on a profile instead of per-session where appropriate.`
}

/** Build the recommend-only statement for a merge-tree table setting. */
function mergeTreeSettingDdl(name: string, value: string): string {
  return `-- Per-table (review before running; applies to <db>.<table>):\nALTER TABLE <db>.<table> MODIFY SETTING ${name} = ${value};`
}

const SETTINGS_RULES: SettingRule[] = [
  {
    name: 'max_memory_usage',
    source: 'settings',
    check: (row) => {
      const v = toNumber(row.value)
      if (v === null || v !== 0) return null
      return {
        title: 'max_memory_usage is unlimited (0)',
        rationale:
          'max_memory_usage = 0 lets a single query allocate without bound, so one heavy query can OOM the server and take down every other query with it.',
        evidence: `current value: 0 (unlimited), default: ${row.default || '(server-defined)'}`,
        estimatedBenefit:
          'Setting a per-query cap (e.g. a sensible fraction of RAM) contains blast radius so a runaway query fails alone instead of crashing the server. Estimate the value from your box: leave headroom for concurrency.',
        severity: 'high',
        ddl: serverSettingDdl('max_memory_usage', '10000000000'),
        risk: 'medium',
        riskNote:
          'Set the cap high enough for legitimate heavy queries or they will start failing with MEMORY_LIMIT_EXCEEDED. Tune to your workload and RAM.',
      }
    },
  },
  {
    name: 'max_bytes_before_external_group_by',
    source: 'settings',
    check: (row) => {
      const v = toNumber(row.value)
      if (v === null || v !== 0) return null
      return {
        title:
          'GROUP BY cannot spill to disk (max_bytes_before_external_group_by = 0)',
        rationale:
          'With max_bytes_before_external_group_by = 0, a high-cardinality GROUP BY must hold the entire hash table in RAM and hits the memory limit instead of spilling to disk.',
        evidence: `current value: 0 (disabled), default: ${row.default || '(server-defined)'}`,
        estimatedBenefit:
          'Allowing external GROUP BY (set to roughly half of max_memory_usage) lets large aggregations complete by spilling to disk rather than failing. Estimate from your memory cap.',
        severity: 'medium',
        ddl: serverSettingDdl(
          'max_bytes_before_external_group_by',
          '5000000000'
        ),
        risk: 'low',
        riskNote:
          'Spilling to disk is slower than in-memory aggregation; this trades some speed for not failing on big GROUP BYs.',
      }
    },
  },
  {
    name: 'max_execution_time',
    source: 'settings',
    check: (row) => {
      const v = toNumber(row.value)
      if (v === null || v !== 0) return null
      return {
        title: 'No query execution timeout (max_execution_time = 0)',
        rationale:
          'max_execution_time = 0 means queries can run indefinitely; a single stuck query can hold resources and connections open forever.',
        evidence: `current value: 0 (no limit), default: ${row.default || '(server-defined)'}`,
        estimatedBenefit:
          'A timeout (e.g. 60-300s for interactive workloads) bounds worst-case query time and frees resources predictably. Estimate from your slowest legitimate query.',
        severity: 'medium',
        ddl: serverSettingDdl('max_execution_time', '300'),
        risk: 'low',
        riskNote:
          'Set above your slowest legitimate query or it will be killed mid-flight. Long ETL/backfill jobs may need a higher per-session override.',
      }
    },
  },
  {
    name: 'index_granularity',
    source: 'merge_tree_settings',
    check: (row) => {
      const v = toNumber(row.value)
      if (v === null || v === 8192) return null
      // Only flag clear outliers; small deviations are often intentional.
      if (v >= 4096 && v <= 16384) return null
      return {
        title: `index_granularity is an outlier (${row.value})`,
        rationale: `index_granularity = ${row.value} is far from the default 8192. Very small values bloat the primary index and mark cache; very large values coarsen pruning so more data is read per query.`,
        evidence: `current value: ${row.value}, default: 8192`,
        estimatedBenefit:
          'Unless set deliberately, moving back toward 8192 balances index size against pruning precision. This is a per-table default and only affects new parts.',
        severity: 'low',
        ddl: mergeTreeSettingDdl('index_granularity', '8192'),
        risk: 'medium',
        riskNote:
          'index_granularity is often tuned on purpose for a specific access pattern — confirm the current value was not chosen deliberately before changing it. Only affects newly written parts.',
      }
    },
  },
  {
    name: 'parts_to_throw_insert',
    source: 'merge_tree_settings',
    check: (row) => {
      const v = toNumber(row.value)
      if (v === null || v >= 300) return null
      return {
        title: `parts_to_throw_insert is low (${row.value})`,
        rationale: `parts_to_throw_insert = ${row.value} rejects inserts once a partition has that many active parts. A low value plus bursty inserts causes "too many parts" errors before merges catch up.`,
        evidence: `current value: ${row.value}, default: 3000 (recent CH) — well above this`,
        estimatedBenefit:
          'Raising it (toward the modern default) tolerates insert bursts while merges run. Prefer fixing insert batching first; treat this as a safety-valve adjustment.',
        severity: 'medium',
        ddl: mergeTreeSettingDdl('parts_to_throw_insert', '3000'),
        risk: 'medium',
        riskNote:
          'A very high value hides a real insert/merge imbalance and lets part counts grow unbounded — pair any increase with checking merge throughput and insert batch sizes.',
      }
    },
  },
]

/** Run every settings rule over the gathered rows. */
export function runSettingsRules(rows: SettingRow[]): TuningFinding[] {
  const byKey = new Map<string, SettingRow>()
  for (const row of rows) byKey.set(`${row.source}:${row.name}`, row)

  const findings: TuningFinding[] = []
  for (const rule of SETTINGS_RULES) {
    const row = byKey.get(`${rule.source}:${rule.name}`)
    if (!row) continue
    const partial = rule.check(row)
    if (!partial) continue
    findings.push({
      ...partial,
      ruleId: 'setting_tuning',
      category: 'settings',
      target: row.name,
      estimatedBytesSaved: 0,
    })
  }
  return findings
}

export { SETTINGS_RULES }
