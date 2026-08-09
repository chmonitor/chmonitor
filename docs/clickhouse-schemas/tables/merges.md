---
table: system.merges
---

# system.merges Schema History

## Change History

| Version | Change |
|---------|--------|
| 26.6+ | Added `current_projection`, `current_projection_progress`, `projections_completed`, `projections_remaining` |

## chmonitor usage

- `merges` config: base SQL stubs projection display columns; `since: '26.6'` reads real columns.

## References

- [ClickHouse Docs: system.merges](https://clickhouse.com/docs/en/operations/system-tables/merges)
