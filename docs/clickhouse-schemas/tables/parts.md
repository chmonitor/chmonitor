---
table: system.parts
---

# system.parts Schema History

Information about parts of MergeTree tables.

## Version Compatibility Matrix

| Column | 19.x | 21.8 | 23.8 | 24.1+ | Notes |
|--------|------|------|------|-------|-------|
| name | Yes | Yes | Yes | Yes | Part name |
| partition | Yes | Yes | Yes | Yes | Partition name |
| level | Yes | Yes | Yes | Yes | Depth of merge tree |
| rows | Yes | Yes | Yes | Yes | Number of rows |
| bytes_on_disk | Yes | Yes | Yes | Yes | Total bytes on disk |
| data_compressed_bytes | Yes | Yes | Yes | Yes | Compressed data size |
| data_uncompressed_bytes | Yes | Yes | Yes | Yes | Uncompressed data size |
| marks | Yes | Yes | Yes | Yes | Number of marks (NOT marks_count) |
| primary_key_bytes_in_memory | Yes | Yes | Yes | Yes | Memory used by primary key |
| primary_key_bytes_in_memory_allocated | Yes | Yes | Yes | Yes | Memory reserved for primary key |
| modification_time | Yes | Yes | Yes | Yes | Part modification time |
| min_date | Yes | Yes | Yes | Yes | Minimum date value |
| max_date | Yes | Yes | Yes | Yes | Maximum date value |
| min_block_number | Yes | Yes | Yes | Yes | Minimum block number |
| max_block_number | Yes | Yes | Yes | Yes | Maximum block number |
| disk_name | Yes | Yes | Yes | Yes | Name of disk storing part |
| path | Yes | Yes | Yes | Yes | Path to part folder |
| active | Yes | Yes | Yes | Yes | Whether part is active |
| has_lightweight_delete | - | - | Yes | Yes | Added in 22.x |
| files | - | - | - | 26.1+ | Array of files in the part (ClickHouse 26.1+) |

## Change History

| Version | Change |
|---------|--------|
| 26.1+ | Added `files` — files belonging to the part (`length(files)` for count) |

## Common Mistakes

- **marks vs marks_count**: The column is `marks`, NOT `marks_count`
- Both `primary_key_bytes_in_memory` columns have been available since at least v19.x
- **files**: only on 26.1+; never select without a VersionedSql gate

## chmonitor usage

- `part-info` uses `length(files) AS files_count` with `since: '26.1'`; older variants stub `files_count` as 0.

## References

- [ClickHouse Docs: system.parts](https://clickhouse.com/docs/en/operations/system-tables/parts)
- [GitHub Source](https://github.com/ClickHouse/ClickHouse/blob/master/docs/en/operations/system-tables/parts.md)
