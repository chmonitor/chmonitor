/**
 * Shape of a row from `system.query_log` as returned by the
 * `query-detail` query config. Only the fields this component reads
 * are typed here; the index signature keeps it tolerant of extras.
 */
export interface QueryDetailRow {
  query_id?: string
  type?: string
  event_time?: string
  query_start_time?: string
  query_finish_time?: string
  query_duration?: number | string
  query?: string
  readable_query?: string
  exception_code?: number | string
  exception_text?: string
  stack_trace?: string
  user?: string
  query_kind?: string
  is_initial_query?: number | boolean
  databases?: string
  tables?: string
  read_rows?: number | string
  readable_read_rows?: string
  written_rows?: number | string
  readable_written_rows?: string
  result_rows?: number | string
  readable_result_rows?: string
  memory_usage?: number | string
  readable_memory_usage?: string
  peak_memory_usage?: number | string
  readable_peak_memory_usage?: string
  read_bytes?: number | string
  readable_read_bytes?: string
  written_bytes?: number | string
  writable_written_bytes?: string
  client_name?: string
  client_hostname?: string
  initial_user?: string
  initial_query_id?: string
  initial_address?: string
  interfaces?: string
  ProfileEvents?: Record<string, number | string>
  Settings?: Record<string, string>
  [key: string]: unknown
}

/** Row from the `query-children` config (distributed/parallel query leaves). */
export interface ChildQueryRow {
  query_id?: string
  type?: string
  event_time?: string
  query_duration?: number | string
  user?: string
  query_kind?: string
  read_rows?: number | string
  readable_read_rows?: string
  memory_usage?: number | string
  readable_memory_usage?: string
  query_preview?: string
  [key: string]: unknown
}
