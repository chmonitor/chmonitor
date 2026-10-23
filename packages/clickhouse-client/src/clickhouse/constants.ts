export const DEFAULT_CLICKHOUSE_MAX_EXECUTION_TIME = '60'
/**
 * The minimal leading comment on every dashboard query. With attribution on,
 * the client wrapper replaces it with the full attribution comment, which
 * keeps the same `"client":"clickhouse-monitoring"` key first.
 */
export const QUERY_COMMENT = '/* {"client":"clickhouse-monitoring"} */\n'

/**
 * The substring every dashboard query carries, minimal or attributed. Match
 * on this, never on {@link QUERY_COMMENT} itself, to skip the dashboard's
 * own queries.
 */
export const QUERY_COMMENT_FINGERPRINT = '"client":"clickhouse-monitoring"'
