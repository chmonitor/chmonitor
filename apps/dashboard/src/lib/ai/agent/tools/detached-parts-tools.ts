/**
 * Detached parts triage tool (#4070): the same per-(database, table, reason)
 * view as the `detached-parts-triage` page, for the agent.
 *
 * Read-only and recommend-only. The SQL is the page's own query config text
 * with two derived edits (see `buildDetachedPartsTriageSql`): the source table
 * is pre-filtered by bound parameters, and the row cap is lowered. Model
 * supplied `database` / `table` values reach ClickHouse ONLY as bound query
 * parameters, never through string interpolation. The result never says a part
 * is safe to drop and never contains DROP / ALTER / ATTACH text: advisors do
 * not write to customer clusters.
 */

import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'
import { detachedPartsTriageConfig } from '@/lib/query-config/tables/detached-parts-triage'

export const DETACHED_PARTS_LIMIT = 50

export const DETACHED_PARTS_CAVEATS = [
  'Scope: system.detached_parts on this replica only. Other replicas and shards keep their own detached parts and their own active parts.',
  "Coverage here (covered_by_active) means a detached part's block range sits inside an active part of the same partition on THIS replica. It does not prove any other replica holds the data.",
  'Review each part before any removal. Classes are review aids, not verdicts: no class means safe to remove.',
  'Parts with reason attaching, deleting or tmp-fetch (class cannot_drop_via_sql) are still owned by ClickHouse and cannot be removed via SQL.',
  'needs_attention (broken, broken-on-start, unexpected, noquorum) is never reviewable on coverage alone.',
  'This tool never changes anything and never produces a command to remove or attach a part; the owner decides.',
] as const

export const DETACHED_SOURCE_ANCHOR = 'FROM system.detached_parts AS dp'
export const DETACHED_LIMIT_ANCHOR = 'LIMIT 200'
const FILTERED_SOURCE = `FROM (
              SELECT * FROM system.detached_parts
              WHERE ({database:String} = '' OR database = {database:String})
                AND ({table:String} = '' OR table = {table:String})
          ) AS dp`

/**
 * The page's SQL, narrowed by two bound parameters (`database`, `table`; the
 * empty string means no filter) and capped at DETACHED_PARTS_LIMIT rows. The
 * anchors are asserted so a rewrite of the config fails loudly, not silently.
 * The filter sits on the source table, before grouping, so it can never drop a
 * matching group the way filtering a capped result would. No WITH aliases
 * (they break under enable_analyzer=0).
 */
export function buildDetachedPartsTriageSql(): string {
  // The config has a variant per ClickHouse version. The tool does not detect
  // the server version, so it uses the newest variant (the one with real
  // modification times); on a server too old for it the query fails and the
  // tool reports that through its fail-open error.
  const { sql } = detachedPartsTriageConfig
  const base = typeof sql === 'string' ? sql : sql[sql.length - 1]?.sql
  if (!base) {
    throw new Error('detached-parts-triage config has no sql')
  }
  for (const anchor of [DETACHED_SOURCE_ANCHOR, DETACHED_LIMIT_ANCHOR]) {
    if (base.split(anchor).length !== 2) {
      throw new Error(
        `detached-parts-triage config no longer contains exactly one "${anchor}"`
      )
    }
  }
  return base
    .replace(DETACHED_SOURCE_ANCHOR, FILTERED_SOURCE)
    .replace(DETACHED_LIMIT_ANCHOR, `LIMIT ${DETACHED_PARTS_LIMIT}`)
}

type Row = Record<string, unknown>

function shapeRow(r: Row) {
  return {
    database: String(r.database ?? ''),
    table: String(r.table ?? ''),
    reason: String(r.reason ?? ''),
    triage: String(r.triage ?? ''),
    parts: Number(r.parts) || 0,
    bytes: Number(r.bytes) || 0,
    readable_bytes: String(r.readable_bytes ?? ''),
    partitions: Number(r.partitions) || 0,
    covered_by_active: Number(r.covered_by_active) || 0,
    oldest_modified:
      r.oldest_modified == null ? null : String(r.oldest_modified),
    newest_modified:
      r.newest_modified == null ? null : String(r.newest_modified),
    oldest_age_days: Number(r.oldest_age_days) || 0,
  }
}

export function createDetachedPartsTools(hostId: number) {
  return {
    get_detached_parts_triage: dynamicTool({
      description:
        'List detached parts grouped by database, table and reason (largest first, top 50) with a review class, part and byte counts, partitions, oldest/newest modification time and covered_by_active. Use for "why is there detached data", "what are these detached parts", "are detached parts a problem" questions. Optional `database` and `table` narrow it. THIS REPLICA ONLY: covered_by_active means a detached part sits inside an active part on this replica, which does not prove other replicas hold the data. Classes: cannot_drop_via_sql (attaching_, deleting_, tmp-fetch_ parts ClickHouse still owns), needs_attention (broken, broken-on-start, unexpected, noquorum), review_after_coverage_check, review. No class means safe to remove. Read-only: it never changes anything and never produces a command to remove or attach a part. Report the scope and caveats and tell the user to review each part before any removal.',
      inputSchema: z.object({
        database: z
          .string()
          .optional()
          .describe('Only this database. Omit for all databases.'),
        table: z
          .string()
          .optional()
          .describe(
            'Only this table (name without the database). Omit for all tables.'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          database,
          table,
          hostId: toolHostId,
        } = input as { database?: string; table?: string; hostId?: number }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        try {
          const data = await readOnlyQuery({
            query: buildDetachedPartsTriageSql(),
            hostId: resolvedHostId,
            query_params: { database: database ?? '', table: table ?? '' },
          })
          const rows = (Array.isArray(data) ? (data as Row[]) : []).map(
            shapeRow
          )
          return {
            ok: true,
            scope: 'this replica only',
            caveats: DETACHED_PARTS_CAVEATS,
            filter: { database: database || null, table: table || null },
            truncated: rows.length >= DETACHED_PARTS_LIMIT,
            groups: rows,
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            ok: false,
            scope: 'this replica only',
            caveats: DETACHED_PARTS_CAVEATS,
            error: `Could not read system.detached_parts (it may be missing on this server or not readable by this user): ${message}`,
          }
        }
      },
    }),
  }
}
