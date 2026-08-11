---
table: system.mutations
---

# system.mutations Schema History

## Change History

| Version | Change |
|---------|--------|
| 25.12+ | Added `parts_in_progress_names` |
| 26.2+ | Added `parts_postpone_reasons` |

## chmonitor usage

- Mutations config gates real `parts_in_progress_names` at `since: '25.12'` (older variants stub `[] AS parts_in_progress_names`).
- Mutations config gates `parts_postpone_reasons` at `since: '26.2'`; the expanded row detail panel surfaces it.

## References

- [ClickHouse Docs: system.mutations](https://clickhouse.com/docs/en/operations/system-tables/mutations)
