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
- `parts_postpone_reasons` is documented for a follow-up UI column.

## References

- [ClickHouse Docs: system.mutations](https://clickhouse.com/docs/en/operations/system-tables/mutations)
