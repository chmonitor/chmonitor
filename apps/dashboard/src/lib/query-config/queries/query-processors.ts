import type { QueryConfig } from '@/types/query-config'

/**
 * query-processors: per-processor timing for a single query, the closest
 * available "where did the time go" breakdown for a stages view.
 *
 * Source: `system.processors_profile_log` (requires `log_processor_profiles=1`,
 * on by default). Grouped by processor `name` so repeat invocations of the same
 * processor roll up; ordered by self-time so the heaviest stages lead. The page
 * renders this as a horizontal duration-proportional bar chart (active vs
 * input-wait vs output-wait).
 *
 * Note: this is a duration-proportional breakdown, not a wall-clock Gantt —
 * `processors_profile_log` carries aggregate elapsed per processor, not
 * start/finish offsets. A true time-axis Gantt needs OpenTelemetry spans
 * (`opentelemetry_span_log`), which require tracing enabled on the server.
 *
 * The table is optional; the page hides this section when it is empty.
 */
export const queryProcessorsConfig: QueryConfig = {
  name: 'query-processors',
  description:
    'Per-processor timing breakdown for a query (processors_profile_log)',
  docs: "The required table 'processors_profile_log' may be missing. See https://clickhouse.com/docs/en/operations/system-tables/processors_profile_log",
  permission: { feature: 'queries' },
  optional: true,
  tableCheck: 'system.processors_profile_log',
  sql: `
    SELECT
      name,
      sum(elapsed_us) AS elapsed_us,
      sum(input_wait_elapsed_us) AS input_wait_us,
      sum(output_wait_elapsed_us) AS output_wait_us,
      sum(input_rows) AS input_rows,
      sum(output_rows) AS output_rows
    FROM system.processors_profile_log
    WHERE query_id = {query_id: String}
    GROUP BY name
    ORDER BY elapsed_us DESC
    LIMIT 20
  `,
  columns: [
    'name',
    'elapsed_us',
    'input_wait_us',
    'output_wait_us',
    'input_rows',
    'output_rows',
  ],
  defaultParams: {
    query_id: '',
  },
}
