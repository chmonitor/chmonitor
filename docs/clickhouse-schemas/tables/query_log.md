---
table: system.query_log
---

# system.query_log Schema History

## Change History

| Version | Change |
|---------|--------|
| 24.1+ | Added `query_cache_usage` |
| 26.6+ | Added `client_agent` (AI coding agent detection) |

## chmonitor usage

- Slow / expensive / history query configs select real `query_cache_usage` with `since: '24.1'` (older variants stub the display column).
- `client_agent` is selected with `since: '26.6'`.

## References

- [ClickHouse Docs: system.query_log](https://clickhouse.com/docs/en/operations/system-tables/query_log)
