/**
 * Usage findings tool (#4067, slice 5): tables, columns and projections that
 * the query log shows no finished SELECT reading or using.
 *
 * Read-only, fixed SQL (shared with the insight collector via
 * `lib/insights/usage-findings-sql.ts`) through `readOnlyQuery`, which forces
 * `readonly` and also serves a user's own bound connection. Every result
 * carries the same caveats as the insight cards: this replica only, the window
 * start is shown, and unread is not the same as unused.
 */

import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'
import { formatReadableSize } from '@/lib/format-readable'
import {
  USAGE_FINDINGS_SETTINGS,
  USAGE_WINDOW_DAYS,
  unreadColumnsSql,
  unreadTablesSql,
  unusedProjectionsSql,
  usageLogWindowSql,
} from '@/lib/insights/usage-findings-sql'

export const USAGE_TABLES_LIMIT = 20
export const USAGE_COLUMNS_LIMIT = 50
export const USAGE_PROJECTIONS_LIMIT = 20
/** A log covering fewer days than this says little about what is read. */
export const USAGE_SHORT_WINDOW_DAYS = 7

export const USAGE_CAVEATS = [
  "Scope: only this replica's system.query_log was checked. Other replicas and shards keep their own log and may still read these objects.",
  `Window: findings cover at most the last ${USAGE_WINDOW_DAYS} days and only as far back as the log reaches (see window.start). A short log proves nothing.`,
  'Unread is not the same as unused: jobs that run less often than the log retains, reads through views or materialized views, and INSERT ... SELECT are not attributed here.',
  'Columns: queries containing SELECT * are left out of the read set, so a column read only through a wildcard looks unread.',
  'Projections: data-skipping indices are not covered because the query log does not record which indices a query used.',
  'This tool never changes anything and never states that an object is safe to remove; the owner decides.',
] as const

type Row = Record<string, unknown>

function asRows(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : []
}

function shape(row: Row, withName: boolean, withType: boolean) {
  const bytes = Number(row.bytes) || 0
  return {
    database: String(row.database ?? ''),
    table: String(row.table ?? ''),
    ...(withName ? { name: String(row.name ?? '') } : {}),
    ...(withType ? { type: String(row.type ?? '') } : {}),
    bytes,
    readable_bytes: formatReadableSize(bytes, 2),
  }
}

export function createUsageTools(hostId: number) {
  return {
    get_usage_findings: dynamicTool({
      description:
        'List what the query log shows is NOT being read: the largest MergeTree tables no finished SELECT read, the unused projections (largest first), and, when `database` and `table` are both given, that table\'s columns no SELECT referenced. Use for "which tables are never queried", "what is unused", "what can we clean up" questions. Every result states the log window start (window.start) and carries caveats: it sees THIS replica only, unread is NOT the same as unused (jobs rarer than the log retention, views and INSERT ... SELECT are invisible), and columns read only through SELECT * look unread. Read-only: it never changes anything and never says an object is safe to drop. Report the window and caveats with the findings and leave the decision to the owner.',
      inputSchema: z.object({
        database: z
          .string()
          .optional()
          .describe(
            "With `table`, also list that table's unread columns. Omit both for tables and projections only."
          ),
        table: z
          .string()
          .optional()
          .describe('Table name (without the database) for unread columns.'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          database,
          table,
          hostId: toolHostId,
        } = input as { database?: string; table?: string; hostId?: number }
        if (Boolean(database) !== Boolean(table)) {
          return {
            ok: false,
            error:
              'Give both `database` and `table` for unread columns, or neither for tables and projections only.',
          }
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const errors: Record<string, string> = {}
        const run = async (
          section: string,
          query: string,
          query_params?: Record<string, unknown>
        ): Promise<Row[]> => {
          try {
            return asRows(
              await readOnlyQuery({
                query,
                hostId: resolvedHostId,
                query_params,
                clickhouse_settings: USAGE_FINDINGS_SETTINGS,
              })
            )
          } catch (err) {
            errors[section] = err instanceof Error ? err.message : String(err)
            return []
          }
        }

        const [windowRows, tables, projections, columns] = await Promise.all([
          run('window', usageLogWindowSql),
          run(
            'unread_tables',
            unreadTablesSql({ minBytes: 1, limit: USAGE_TABLES_LIMIT })
          ),
          run(
            'unused_projections',
            unusedProjectionsSql({
              minBytes: 1,
              limit: USAGE_PROJECTIONS_LIMIT,
            })
          ),
          database && table
            ? run(
                'unread_columns',
                unreadColumnsSql({ limit: USAGE_COLUMNS_LIMIT }),
                { table: `${database}.${table}` }
              )
            : Promise.resolve([] as Row[]),
        ])

        const w = windowRows[0] ?? {}
        const days =
          w.log_window_days == null ? null : Number(w.log_window_days)
        const start =
          w.log_window_start == null ? null : String(w.log_window_start)
        const shortLog = days == null || days < USAGE_SHORT_WINDOW_DAYS

        return {
          ok: Object.keys(errors).length === 0,
          scope: 'this replica only',
          window: {
            start,
            days,
            requested_days: USAGE_WINDOW_DAYS,
            finished_selects: Number(w.selects) || 0,
          },
          ...(shortLog
            ? {
                warning: `The query log covers ${days ?? 0} days here (fewer than ${USAGE_SHORT_WINDOW_DAYS}), so "unread" proves almost nothing. Do not present these as findings.`,
              }
            : {}),
          caveats: USAGE_CAVEATS,
          unread_tables: tables.map((r) => shape(r, false, false)),
          unread_columns:
            database && table ? columns.map((r) => shape(r, true, true)) : null,
          unused_projections: projections.map((r) => shape(r, true, false)),
          ...(Object.keys(errors).length > 0 ? { errors } : {}),
        }
      },
    }),
  }
}
