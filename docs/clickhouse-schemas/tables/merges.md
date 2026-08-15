---
table: system.merges
---

# system.merges Schema History

## Change History

| Version | Change |
|---------|--------|
| 21.11+ | Added `merge_type`, `merge_algorithm` |
| 26.6+ | Added `current_projection`, `current_projection_progress`, `projections_completed`, `projections_remaining` |

`projections_completed` / `projections_remaining` are `Array(String)`, not counters.

## chmonitor usage

- `merges` config: base SQL stubs merge-type and projection display columns;
  `since: '21.11'` reads real `merge_type` / `merge_algorithm`; `since: '26.6'`
  reads the projection columns and exposes the two arrays as counts via
  `length(...)`.
- Never `SELECT *` from `system.merges` alongside
  `database || '.' || table AS table` — the alias collides with the table's own
  `table` column and yields a duplicate column (`AMBIGUOUS_COLUMN_NAME`, or a
  duplicated key in the JSON response).
- `system.merges` only holds merges in flight, so an idle cluster legitimately
  returns zero rows; the config carries a `suggestion` explaining that.

## References

- [ClickHouse Docs: system.merges](https://clickhouse.com/docs/en/operations/system-tables/merges)
