import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * Read-only triage view over system.detached_parts, one row per
 * (database, table, reason).
 *
 * `covered_by_active` counts detached parts whose block range
 * [min_block_number, max_block_number] lies inside one ACTIVE part of the same
 * partition on THIS replica. That is not proof the data survives elsewhere.
 * The class never says "safe": coverage never overrides a `broken` class or a
 * part ClickHouse still owns (`attaching_`, `deleting_`, `tmp-fetch_`).
 *
 * `reason` is the directory prefix ClickHouse parses off the part name (the
 * column exists since before 23.8); a manually detached part has none and shows
 * as `unknown`. Active parts are folded into one array of block ranges per
 * partition so the coverage test is a lambda in SELECT, not a range join
 * (range joins need a newer server) and not a correlated EXISTS (needs the new
 * analyzer). The one-hop derived names (`part_*`, `active_*`) keep every
 * output alias distinct from its source column (#4032).
 */
export const detachedPartsTriageConfig: QueryConfig = {
  name: 'detached-parts-triage',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['reason', 'triage'] },
  description:
    'Detached parts grouped by table and reason, with a review class, largest first (top 200). THIS REPLICA ONLY: covered_by_active counts detached parts whose block range sits inside an active part of the same partition on this replica, and that does not prove other replicas hold the data. Nothing here is a safe-to-drop verdict. Classes: cannot_drop_via_sql (attaching_, deleting_, tmp-fetch_ parts that ClickHouse still owns), needs_attention (broken, broken-on-start, unexpected, noquorum: never reviewable, whatever the coverage), review_after_coverage_check (ignored, clone or covered-by-broken parts, all covered here, newest part older than 30 days: review each part before acting), review (everything else). Unknown reason means the part was detached by hand.',
  tableCheck: 'system.detached_parts',
  sql: `
      SELECT
          dpt.part_database AS database,
          dpt.part_table AS table,
          dpt.part_reason AS reason,
          multiIf(
              countIf(dpt.part_owned = 1) > 0,
              'cannot_drop_via_sql',
              dpt.part_reason IN ('broken', 'broken-on-start', 'unexpected', 'noquorum'),
              'needs_attention',
              dpt.part_reason IN ('ignored', 'clone', 'covered-by-broken')
                AND countIf(dpt.part_covered = 1) = count()
                AND max(dpt.part_modified) < now() - INTERVAL 30 DAY,
              'review_after_coverage_check',
              'review'
          ) AS triage,
          count() AS parts,
          sum(dpt.part_bytes) AS bytes,
          formatReadableSize(sum(dpt.part_bytes)) AS readable_bytes,
          round(sum(dpt.part_bytes) * 100.0 / nullIf(max(sum(dpt.part_bytes)) OVER (), 0), 2) AS pct_bytes,
          uniqExact(dpt.part_partition) AS partitions,
          countIf(dpt.part_covered = 1) AS covered_by_active,
          min(dpt.part_modified) AS oldest_modified,
          max(dpt.part_modified) AS newest_modified,
          dateDiff('day', min(dpt.part_modified), now()) AS oldest_age_days
      FROM
      (
          SELECT
              dp.database AS part_database,
              dp.table AS part_table,
              if(coalesce(dp.reason, '') = '', 'unknown', dp.reason) AS part_reason,
              coalesce(dp.partition_id, '') AS part_partition,
              dp.bytes_on_disk AS part_bytes,
              dp.modification_time AS part_modified,
              toUInt8(
                  dp.reason IN ('attaching', 'deleting', 'tmp-fetch')
                  OR startsWith(dp.name, 'attaching_')
                  OR startsWith(dp.name, 'deleting_')
                  OR startsWith(dp.name, 'tmp-fetch_')
              ) AS part_owned,
              arrayExists(
                  r -> ifNull(r.1 <= dp.min_block_number AND r.2 >= dp.max_block_number, 0),
                  ap.active_ranges
              ) AS part_covered
          FROM system.detached_parts AS dp
          LEFT JOIN
          (
              SELECT
                  ps.database AS active_database,
                  ps.table AS active_table,
                  ps.partition_id AS active_partition,
                  groupArray((ps.min_block_number, ps.max_block_number)) AS active_ranges
              FROM system.parts AS ps
              WHERE (ps.active = 1)
                AND ((ps.database, ps.table) IN (SELECT dq.database, dq.table FROM system.detached_parts AS dq))
              GROUP BY ps.database, ps.table, ps.partition_id
          ) AS ap
              ON (ap.active_database = dp.database)
             AND (ap.active_table = dp.table)
             AND (ap.active_partition = dp.partition_id)
      ) AS dpt
      GROUP BY dpt.part_database, dpt.part_table, dpt.part_reason
      ORDER BY bytes DESC, database, table, reason
      LIMIT 200`,
  columns: [
    'database',
    'table',
    'reason',
    'triage',
    'parts',
    'readable_bytes',
    'partitions',
    'covered_by_active',
    'oldest_modified',
    'newest_modified',
    'oldest_age_days',
  ],
  columnFormats: {
    table: [
      ColumnFormat.Link,
      { href: '/table?host=[ctx.hostId]&database=[database]&table=[table]' },
    ],
    reason: ColumnFormat.ColoredBadge,
    triage: ColumnFormat.ColoredBadge,
    readable_bytes: ColumnFormat.BackgroundBar,
  },
  relatedCharts: [],
}
