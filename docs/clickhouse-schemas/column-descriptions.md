---
title: ClickHouse Column Descriptions
version: "26.5.1.882"
---

# System table column descriptions (ClickHouse 26.5.1.882)

Generated from `system.columns.comment`. Do not edit; regenerate with
`bun run scripts/build-ch-schema-docs.ts --live`. Tables absent on the
source server (for example `system.query_log` on a fresh `clickhouse local`)
are omitted.

## system.processes

| Column | Type | Description |
|--------|------|-------------|
| `is_initial_query` | `UInt8` | Whether this query comes directly from user or was issues by ClickHouse server in a scope of distributed query execution. |
| `user` | `String` | The user who made the query. Keep in mind that for distributed processing, queries are sent to remote servers under the default user. The field contains the username for a specific query, not for a query that this query initiated. |
| `query_id` | `String` | Query ID, if defined. |
| `address` | `IPv6` | The IP address the query was made from. The same for distributed processing. To track where a distributed query was originally made from, look at system.processes on the query requestor server. |
| `port` | `UInt16` | The client port the query was made from. |
| `initial_user` | `String` | Name of the user who ran the initial query (for distributed query execution). |
| `initial_query_id` | `String` | ID of the initial query (for distributed query execution). |
| `initial_address` | `IPv6` | IP address that the parent query was launched from. |
| `initial_port` | `UInt16` | The client port that was used to make the parent query. |
| `interface` | `UInt8` | The interface which was used to send the query. TCP = 1, HTTP = 2, GRPC = 3, MYSQL = 4, POSTGRESQL = 5, LOCAL = 6, TCP_INTERSERVER = 7. |
| `os_user` | `String` | Operating system username who runs clickhouse-client. |
| `client_hostname` | `String` | Hostname of the client machine where the clickhouse-client or another TCP client is run. |
| `client_name` | `String` | The clickhouse-client or another TCP client name. |
| `client_revision` | `UInt64` | Revision of the clickhouse-client or another TCP client. |
| `client_version_major` | `UInt64` | Major version of the clickhouse-client or another TCP client. |
| `client_version_minor` | `UInt64` | Minor version of the clickhouse-client or another TCP client. |
| `client_version_patch` | `UInt64` | Patch component of the clickhouse-client or another TCP client version. |
| `http_method` | `UInt8` | HTTP method that initiated the query. Possible values: 0 — The query was launched from the TCP interface. 1 — GET method was used. 2 — POST method was used. |
| `http_user_agent` | `String` | HTTP header UserAgent passed in the HTTP query. |
| `http_referer` | `String` | HTTP header Referer passed in the HTTP query (contains an absolute or partial address of the page making the query). |
| `forwarded_for` | `String` | HTTP header X-Forwarded-For passed in the HTTP query. |
| `quota_key` | `String` | The quota key specified in the quotas setting (see keyed). |
| `distributed_depth` | `UInt64` | The number of times query was retransmitted between server nodes internally. |
| `elapsed` | `Float64` | The time in seconds since request execution started. |
| `is_cancelled` | `UInt8` | Was query cancelled. |
| `is_all_data_sent` | `UInt8` | Was all data sent to the client (in other words query had been finished on the server). |
| `read_rows` | `UInt64` | The number of rows read from the table. For distributed processing, on the requestor server, this is the total for all remote servers. |
| `read_bytes` | `UInt64` | The number of uncompressed bytes read from the table. For distributed processing, on the requestor server, this is the total for all remote servers. |
| `total_rows_approx` | `UInt64` | The approximation of the total number of rows that should be read. For distributed processing, on the requestor server, this is the total for all remote servers. It can be updated during request processing, when new sources to process become known. |
| `written_rows` | `UInt64` | The amount of rows written to the storage. |
| `written_bytes` | `UInt64` | The amount of bytes written to the storage. |
| `memory_usage` | `Int64` | Amount of RAM the query uses. It might not include some types of dedicated memory |
| `peak_memory_usage` | `Int64` | The current peak of memory usage. |
| `query` | `String` | The query text. For INSERT, it does not include the data to insert. |
| `normalized_query_hash` | `UInt64` | A numeric hash value, such as it is identical for queries differ only by values of literals. |
| `query_kind` | `String` | The type of the query - SELECT, INSERT, etc. |
| `thread_ids` | `Array(UInt64)` | The list of identifiers of all threads which participated in this query. |
| `peak_threads_usage` | `UInt64` | Maximum count of simultaneous threads executing the query. |
| `ProfileEvents` | `Map(LowCardinality(String), UInt64)` | ProfileEvents calculated for this query. |
| `Settings` | `Map(LowCardinality(String), LowCardinality(String))` | The list of modified user-level settings. |
| `current_database` | `String` | The name of the current database. |
| `is_internal` | `UInt8` | Indicates whether it is an auxiliary query executed internally. |
| `ProfileEvents.Names` | `Array(String)` |  |
| `ProfileEvents.Values` | `Array(UInt64)` |  |
| `Settings.Names` | `Array(String)` |  |
| `Settings.Values` | `Array(String)` |  |

## system.parts

| Column | Type | Description |
|--------|------|-------------|
| `partition` | `String` | Partition identifier (string representation derived from the table partition key expression). |
| `name` | `String` | Name of the data part. The part naming structure can be used to determine many aspects of the data, ingest, and merge patterns. The part naming format is the following: |
| `uuid` | `UUID` | The UUID of data part. |
| `part_type` | `String` | The data part storing format. Possible values: `Wide` — each column is stored in a separate file, `Compact` — all columns are stored in one file. Data storing format is controlled by the `min_bytes_for_wide_part` and `min_rows_for_wide_part` settings of the MergeTree table. |
| `active` | `UInt8` | Flag that indicates whether the data part is active. If a data part is active, it's used in a table. Otherwise, it's about to be deleted. Inactive data parts appear after merging and mutating operations. |
| `marks` | `UInt64` | The number of marks. To get the approximate number of rows in a data part, multiply marks by the index granularity (usually 8192) (this hint does not work for adaptive granularity). |
| `rows` | `UInt64` | The number of rows. |
| `files` | `UInt64` | The number of files in the data part. |
| `bytes_on_disk` | `UInt64` | Total size of all the data part files in bytes. |
| `data_compressed_bytes` | `UInt64` | Total size of compressed data in the data part. All the auxiliary files (for example, files with marks) are not included. |
| `data_uncompressed_bytes` | `UInt64` | Total size of uncompressed data in the data part. All the auxiliary files (for example, files with marks) are not included. |
| `primary_key_size` | `UInt64` | The amount of memory (in bytes) used by primary key values in the primary.idx/cidx file on disk. |
| `marks_bytes` | `UInt64` | The size of the file with marks. |
| `secondary_indices_compressed_bytes` | `UInt64` | Total size of compressed data for secondary indices in the data part. All the auxiliary files (for example, files with marks) are not included. |
| `secondary_indices_uncompressed_bytes` | `UInt64` | Total size of uncompressed data for secondary indices in the data part. All the auxiliary files (for example, files with marks) are not included. |
| `secondary_indices_marks_bytes` | `UInt64` | The size of the file with marks for secondary indices. |
| `modification_time` | `DateTime` | The time the directory with the data part was modified. This usually corresponds to the time of data part creation. |
| `remove_time` | `DateTime` | The time when the data part became inactive. |
| `refcount` | `UInt32` | The number of places where the data part is used. A value greater than 2 indicates that the data part is used in queries or merges. |
| `min_date` | `Date` | The minimum value of the date key in the data part. |
| `max_date` | `Date` | The maximum value of the date key in the data part. |
| `min_time` | `DateTime` | The minimum value of the date and time key in the data part. |
| `max_time` | `DateTime` | The maximum value of the date and time key in the data part. |
| `partition_id` | `String` | ID of the partition. |
| `min_block_number` | `Int64` | The minimum number of data parts that make up the current part after merging. |
| `max_block_number` | `Int64` | The maximum number of data parts that make up the current part after merging. |
| `level` | `UInt32` | Depth of the merge tree. Zero means that the current part was created by insert rather than by merging other parts. |
| `data_version` | `UInt64` | Number that is used to determine which mutations should be applied to the data part (mutations with a version higher than data_version). |
| `primary_key_bytes_in_memory` | `UInt64` | The amount of memory (in bytes) used by primary key values. Will be 0 when `primary_key_lazy_load` is enabled and the key is not loaded. When non-zero the bytes live in the part itself and are accounted within `jemalloc.mergetree_arena.active_bytes`. They are NEVER counted in `PrimaryIndexCacheByte… |
| `primary_key_bytes_in_memory_allocated` | `UInt64` | The amount of memory (in bytes) reserved for primary key values. Will be 0 when `primary_key_lazy_load` is enabled and the key is not loaded. When non-zero, included in `jemalloc.mergetree_arena.active_bytes`. See the note on `primary_key_bytes_in_memory` for the relationship with `PrimaryIndexCach… |
| `index_granularity_bytes_in_memory` | `UInt64` | The amount of memory (in bytes) used by index granularity values (will be 0 in case of primary_key_lazy_load=1 and use_primary_key_cache=1). When non-zero the bytes are part-owned and accounted within `jemalloc.mergetree_arena.active_bytes`. |
| `index_granularity_bytes_in_memory_allocated` | `UInt64` | The amount of memory (in bytes) reserved for index granularity values (will be 0 in case of primary_key_lazy_load=1 and use_primary_key_cache=1). When non-zero, included in `jemalloc.mergetree_arena.active_bytes`. |
| `is_frozen` | `UInt8` | Flag that shows that a partition data backup exists. 1, the backup exists. 0, the backup does not exist. For more details, see FREEZE PARTITION. |
| `database` | `String` | Name of the database. |
| `table` | `String` | Name of the table. |
| `engine` | `String` | Name of the table engine without parameters. |
| `disk_name` | `String` | Name of a disk that stores the data part. |
| `path` | `String` | Absolute path to the folder with data part files. |
| `hash_of_all_files` | `String` | sipHash128 of compressed files. |
| `hash_of_uncompressed_files` | `String` | sipHash128 of uncompressed files (files with marks, index file etc.). |
| `uncompressed_hash_of_compressed_files` | `String` | sipHash128 of data in the compressed files as if they were uncompressed. |
| `delete_ttl_info_min` | `DateTime` | The minimum value of the date and time key for TTL DELETE rule. |
| `delete_ttl_info_max` | `DateTime` | The maximum value of the date and time key for TTL DELETE rule. |
| `move_ttl_info.expression` | `Array(String)` | Array of expressions. Each expression defines a TTL MOVE rule. |
| `move_ttl_info.min` | `Array(DateTime)` | Array of date and time values. Each element describes the minimum key value for a TTL MOVE rule. |
| `move_ttl_info.max` | `Array(DateTime)` | Array of date and time values. Each element describes the maximum key value for a TTL MOVE rule. |
| `default_compression_codec` | `String` | The name of the codec used to compress this data part (in case when there is no explicit codec for columns). |
| `recompression_ttl_info.expression` | `Array(String)` | The TTL expression. |
| `recompression_ttl_info.min` | `Array(DateTime)` | The minimum value of the calculated TTL expression within this part. Used to understand whether we have at least one row with expired TTL. |
| `recompression_ttl_info.max` | `Array(DateTime)` | The maximum value of the calculated TTL expression within this part. Used to understand whether we have all rows with expired TTL. |
| `group_by_ttl_info.expression` | `Array(String)` | The TTL expression. |
| `group_by_ttl_info.min` | `Array(DateTime)` | The minimum value of the calculated TTL expression within this part. Used to understand whether we have at least one row with expired TTL. |
| `group_by_ttl_info.max` | `Array(DateTime)` | The maximum value of the calculated TTL expression within this part. Used to understand whether we have all rows with expired TTL. |
| `rows_where_ttl_info.expression` | `Array(String)` | The TTL expression. |
| `rows_where_ttl_info.min` | `Array(DateTime)` | The minimum value of the calculated TTL expression within this part. Used to understand whether we have at least one row with expired TTL. |
| `rows_where_ttl_info.max` | `Array(DateTime)` | The maximum value of the calculated TTL expression within this part. Used to understand whether we have all rows with expired TTL. |
| `projections` | `Array(String)` | The list of projection names calculated for this part. |
| `visible` | `UInt8` | Flag which indicated whether this part is visible for SELECT queries. |
| `creation_tid` | `Tuple(UInt64, UInt64, UUID)` | ID of transaction that has created/is trying to create this object. |
| `removal_tid_lock` | `UInt64` | Hash of removal_tid, used to lock an object for removal. |
| `removal_tid` | `Tuple(UInt64, UInt64, UUID)` | ID of transaction that has removed/is trying to remove this object |
| `creation_csn` | `UInt64` | CSN of transaction that has created this object |
| `removal_csn` | `UInt64` | CSN of transaction that has removed this object |
| `has_lightweight_delete` | `UInt8` | The flag which indicated whether the part has lightweight delete mask. |
| `last_removal_attempt_time` | `DateTime` | The last time the server tried to delete this part. |
| `removal_state` | `String` | The current state of part removal process. |
| `bytes` | `UInt64` |  |
| `marks_size` | `UInt64` |  |
| `part_name` | `String` |  |

## system.merges

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | The name of the database the table is in. |
| `table` | `String` | Table name. |
| `elapsed` | `Float64` | The time elapsed (in seconds) since the merge started. |
| `progress` | `Float64` | The percentage of completed work from 0 to 1. |
| `num_parts` | `UInt64` | The number of parts to be merged. |
| `source_part_names` | `Array(String)` | The list of source parts names. |
| `result_part_name` | `String` | The name of the part that will be formed as the result of merging. |
| `source_part_paths` | `Array(String)` | The list of paths for each source part. |
| `result_part_path` | `String` | The path of the part that will be formed as the result of merging. |
| `partition_id` | `String` | The identifier of the partition where the merge is happening. |
| `partition` | `String` | The name of the partition |
| `is_mutation` | `UInt8` | 1 if this process is a part mutation. |
| `total_size_bytes_compressed` | `UInt64` | The total size of the compressed data in the merged chunks. |
| `total_size_bytes_uncompressed` | `UInt64` | The total size of compressed data in the merged chunks. |
| `total_size_marks` | `UInt64` | The total number of marks in the merged parts. |
| `bytes_read_uncompressed` | `UInt64` | Number of bytes read, uncompressed. |
| `rows_read` | `UInt64` | Number of rows read. |
| `bytes_written_uncompressed` | `UInt64` | Number of bytes written, uncompressed. |
| `rows_written` | `UInt64` | Number of rows written. |
| `columns_written` | `UInt64` | Number of columns written (for Vertical merge algorithm). |
| `memory_usage` | `UInt64` | Memory consumption of the merge process. |
| `thread_id` | `UInt64` | Thread ID of the merge process. |
| `merge_type` | `String` | The type of current merge. Empty if it's an mutation. |
| `merge_algorithm` | `String` | The algorithm used in current merge. Empty if it's an mutation. |

## system.replicas

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | Database name. |
| `table` | `String` | Table name. |
| `uuid` | `UUID` | Table UUID. |
| `engine` | `String` | Table engine name. |
| `is_leader` | `UInt8` | Whether the replica is the leader. Multiple replicas can be leaders at the same time. A replica can be prevented from becoming a leader using the merge_tree setting replicated_can_become_leader. The leaders are responsible for scheduling background merges. Note that writes can be performed to any r… |
| `can_become_leader` | `UInt8` | Whether the replica can be a leader. |
| `is_readonly` | `UInt8` | Whether the replica is in read-only mode. This mode is turned on if the config does not have sections with ClickHouse Keeper, if an unknown error occurred when reinitializing sessions in ClickHouse Keeper, and during session reinitialization in ClickHouse Keeper. |
| `readonly_start_time` | `Nullable(DateTime)` | The timestamp when the replica transitioned into readonly mode. Null if the replica is not in readonly mode. |
| `is_session_expired` | `UInt8` | Whether the session with ClickHouse Keeper has expired. Basically the same as `is_readonly`. |
| `future_parts` | `UInt32` | The number of data parts that will appear as the result of INSERTs or merges that haven't been done yet. |
| `parts_to_check` | `UInt32` | The number of data parts in the queue for verification. A part is put in the verification queue if there is suspicion that it might be damaged. |
| `zookeeper_name` | `String` | The name of the [Zoo]Keeper cluster (possibly auxiliary one) where the table's metadata is stored |
| `zookeeper_path` | `String` | Path to table data in ClickHouse Keeper. |
| `replica_name` | `String` | Replica name in ClickHouse Keeper. Different replicas of the same table have different names. |
| `replica_path` | `String` | Path to replica data in ClickHouse Keeper. The same as concatenating 'zookeeper_path/replicas/replica_path'. |
| `columns_version` | `Int32` | Version number of the table structure. Indicates how many times ALTER was performed. If replicas have different versions, it means some replicas haven't made all of the ALTERs yet. |
| `queue_size` | `UInt32` | Size of the queue for operations waiting to be performed. Operations include inserting blocks of data, merges, and certain other actions. It usually coincides with future_parts. |
| `inserts_in_queue` | `UInt32` | Number of inserts of blocks of data that need to be made. Insertions are usually replicated fairly quickly. If this number is large, it means something is wrong. |
| `merges_in_queue` | `UInt32` | The number of merges waiting to be made. Sometimes merges are lengthy, so this value may be greater than zero for a long time. |
| `part_mutations_in_queue` | `UInt32` | The number of mutations waiting to be made. |
| `queue_oldest_time` | `DateTime` | If `queue_size` greater than 0, shows when the oldest operation was added to the queue. |
| `inserts_oldest_time` | `DateTime` | See `queue_oldest_time`. |
| `merges_oldest_time` | `DateTime` | See `queue_oldest_time`. |
| `part_mutations_oldest_time` | `DateTime` | See `queue_oldest_time`. |
| `oldest_part_to_get` | `String` | The name of the part to fetch from other replicas obtained from the oldest GET_PARTS entry in the replication queue. |
| `oldest_part_to_merge_to` | `String` | The result part name to merge to obtained from the oldest MERGE_PARTS entry in the replication queue. |
| `oldest_part_to_mutate_to` | `String` | The result part name to mutate to obtained from the oldest MUTATE_PARTS entry in the replication queue. |
| `log_max_index` | `UInt64` | Maximum entry number in the log of general activity. This column and the next three (`log_pointer`, `total_replicas`, `active_replicas`) have a non-zero value only where there is an active session with ClickHouse Keeper. |
| `log_pointer` | `UInt64` | Maximum entry number in the log of general activity that the replica copied to its execution queue, plus one. If log_pointer is much smaller than log_max_index, something is wrong. |
| `last_queue_update` | `DateTime` | When the queue was updated last time. |
| `absolute_delay` | `UInt64` | How big lag in seconds the current replica has. |
| `total_replicas` | `UInt32` | The total number of known replicas of this table. |
| `active_replicas` | `UInt32` | The number of replicas of this table that have a session in ClickHouse Keeper (i.e., the number of functioning replicas). |
| `lost_part_count` | `UInt64` | The number of data parts lost in the table by all replicas in total since table creation. Value is persisted in ClickHouse Keeper and can only increase. |
| `last_queue_update_exception` | `String` | When the queue contains broken entries. Especially important when ClickHouse breaks backward compatibility between versions and log entries written by newer versions aren't parseable by old versions. |
| `zookeeper_exception` | `String` | The last exception message, got if the error happened when fetching the info from ClickHouse Keeper. |
| `replica_is_active` | `Map(String, UInt8)` | Map between replica name and is replica active. |
| `readonly_duration` | `Nullable(UInt64)` |  |

## system.tables

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | The name of the database the table is in. |
| `name` | `String` | Table name. |
| `uuid` | `UUID` | Table uuid (Atomic database). |
| `engine` | `String` | Table engine name (without parameters). |
| `is_temporary` | `UInt8` | Flag that indicates whether the table is temporary. |
| `data_paths` | `Array(String)` | Paths to the table data in the file systems. |
| `metadata_path` | `String` | Path to the table metadata in the file system. |
| `metadata_modification_time` | `DateTime` | Time of latest modification of the table metadata. |
| `metadata_version` | `Int32` | Metadata version for ReplicatedMergeTree table, 0 for non ReplicatedMergeTree table. |
| `dependencies_database` | `Array(String)` | Database dependencies. |
| `dependencies_table` | `Array(String)` | Table dependencies (materialized views the current table). |
| `create_table_query` | `String` | The query that was used to create the table. |
| `engine_full` | `String` | Parameters of the table engine. |
| `as_select` | `String` | SELECT query for view. |
| `parameterized_view_parameters` | `Array(Tuple(name String, type String))` | Parameters of parameterized view. |
| `partition_key` | `String` | The partition key expression specified in the table. |
| `sorting_key` | `String` | The sorting key expression specified in the table. |
| `primary_key` | `String` | The primary key expression specified in the table. |
| `sampling_key` | `String` | The sampling key expression specified in the table. |
| `unique_key` | `String` | The unique key expression specified in the table (UNIQUE KEY clause). |
| `storage_policy` | `String` | The storage policy. Relevant for tables using MergeTree and Distributed engines. |
| `total_rows` | `Nullable(UInt64)` | Total number of rows, if it is possible to quickly determine exact number of rows in the table, otherwise NULL (including underlying Buffer table). |
| `total_bytes` | `Nullable(UInt64)` | Total number of bytes, if it is possible to quickly determine exact number of bytes for the table on storage, otherwise NULL (does not includes any underlying storage). If the table stores data on disk, returns used space on disk (i.e. compressed). If the table stores data in memory, returns approx… |
| `total_bytes_uncompressed` | `Nullable(UInt64)` | Total number of uncompressed bytes, if it's possible to quickly determine the exact number of bytes from the part checksums for the table on storage, otherwise NULL (does not take underlying storage (if any) into account). |
| `parts` | `Nullable(UInt64)` | The total number of parts in this table. |
| `active_parts` | `Nullable(UInt64)` | The number of active parts in this table. |
| `total_marks` | `Nullable(UInt64)` | The total number of marks in all parts in this table. |
| `active_on_fly_data_mutations` | `UInt64` | Total number of active data mutations (UPDATEs and DELETEs) suitable for applying on the fly. |
| `active_on_fly_alter_mutations` | `UInt64` | Total number of active alter mutations (MODIFY COLUMN) suitable for applying on the fly. |
| `active_on_fly_metadata_mutations` | `UInt64` | Total number of active metadata mutations (RENAMEs) suitable for applying on the fly. |
| `columns_descriptions_cache_size` | `UInt64` | Size of columns description cache for *MergeTree tables |
| `lifetime_rows` | `Nullable(UInt64)` | Total number of rows INSERTed since server start (only for Buffer tables). |
| `lifetime_bytes` | `Nullable(UInt64)` | Total number of bytes INSERTed since server start (only for Buffer tables). |
| `comment` | `String` | The comment for the table. |
| `has_own_data` | `UInt8` | Flag that indicates whether the table itself stores some data on disk or only accesses some other source. |
| `loading_dependencies_database` | `Array(String)` | Database loading dependencies (list of objects which should be loaded before the current object). |
| `loading_dependencies_table` | `Array(String)` | Table loading dependencies (list of objects which should be loaded before the current object). |
| `loading_dependent_database` | `Array(String)` | Dependent loading database. |
| `loading_dependent_table` | `Array(String)` | Dependent loading table. |
| `definer` | `String` | SQL security definer's name used for the table. |
| `table` | `String` |  |

## system.columns

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | Database name. |
| `table` | `String` | Table name. |
| `name` | `String` | Column name. |
| `type` | `String` | Column type. |
| `position` | `UInt64` | Ordinal position of a column in a table starting with 1. |
| `default_kind` | `String` | Expression type (DEFAULT, MATERIALIZED, ALIAS) for the default value, or an empty string if it is not defined. |
| `default_expression` | `String` | Expression for the default value, or an empty string if it is not defined. |
| `data_compressed_bytes` | `UInt64` | The size of compressed data, in bytes. |
| `data_uncompressed_bytes` | `UInt64` | The size of decompressed data, in bytes. |
| `marks_bytes` | `UInt64` | The size of marks, in bytes. |
| `comment` | `String` | Comment on the column, or an empty string if it is not defined. |
| `is_in_partition_key` | `UInt8` | Flag that indicates whether the column is in the partition expression. |
| `is_in_sorting_key` | `UInt8` | Flag that indicates whether the column is in the sorting key expression. |
| `is_in_primary_key` | `UInt8` | Flag that indicates whether the column is in the primary key expression. |
| `is_in_sampling_key` | `UInt8` | Flag that indicates whether the column is in the sampling key expression. |
| `compression_codec` | `String` | Compression codec name. |
| `character_octet_length` | `Nullable(UInt64)` | Maximum length in bytes for binary data, character data, or text data and images. In ClickHouse makes sense only for FixedString data type. Otherwise, the NULL value is returned. |
| `numeric_precision` | `Nullable(UInt64)` | Accuracy of approximate numeric data, exact numeric data, integer data, or monetary data. In ClickHouse it is bit width for integer types and decimal precision for Decimal types. Otherwise, the NULL value is returned. |
| `numeric_precision_radix` | `Nullable(UInt64)` | The base of the number system is the accuracy of approximate numeric data, exact numeric data, integer data or monetary data. In ClickHouse it's 2 for integer types and 10 for Decimal types. Otherwise, the NULL value is returned. |
| `numeric_scale` | `Nullable(UInt64)` | The scale of approximate numeric data, exact numeric data, integer data, or monetary data. In ClickHouse makes sense only for Decimal types. Otherwise, the NULL value is returned. |
| `datetime_precision` | `Nullable(UInt64)` | Decimal precision of DateTime64 data type. For other data types, the NULL value is returned. |
| `serialization_hint` | `Nullable(String)` | A hint for column to choose serialization on inserts according to statistics. |
| `statistics` | `String` | The types of statistics created in this columns. |
| `column` | `String` |  |

## system.disks

| Column | Type | Description |
|--------|------|-------------|
| `name` | `String` | Name of a disk in the server configuration. |
| `path` | `String` | Path to the mount point in the file system. |
| `free_space` | `UInt64` | Free space on disk in bytes. |
| `total_space` | `UInt64` | Disk volume in bytes. |
| `unreserved_space` | `UInt64` | Free space which is not taken by reservations (free_space minus the size of reservations taken by merges, inserts, and other disk write operations currently running). |
| `keep_free_space` | `UInt64` | Amount of disk space that should stay free on disk in bytes. Defined in the keep_free_space_bytes parameter of disk configuration. |
| `type` | `String` | The disk type which tells where this disk stores the data - RAM, local drive or remote storage. |
| `object_storage_type` | `String` | Type of object storage if disk type is object_storage |
| `metadata_type` | `String` | Type of metadata storage if disk type is object_storage |
| `is_encrypted` | `UInt8` | Flag which shows whether this disk encrypts the underlying data. |
| `is_read_only` | `UInt8` | Flag which indicates that you can only perform read operations with this disk. |
| `is_write_once` | `UInt8` | Flag which indicates if disk is write-once. Which means that it does support BACKUP to this disk, but does not support INSERT into MergeTree table on this disk. |
| `is_remote` | `UInt8` | Flag which indicated what operations with this disk involve network interaction. |
| `is_broken` | `UInt8` | Flag which indicates if disk is broken. Broken disks will have 0 space and cannot be used. |
| `cache_path` | `String` | The path to the cache directory on local drive in case when the disk supports caching. |

## system.clusters

| Column | Type | Description |
|--------|------|-------------|
| `cluster` | `String` | The cluster name. |
| `shard_num` | `UInt32` | The shard number in the cluster, starting from 1. |
| `shard_name` | `String` | The name of the shard in the cluster. |
| `shard_weight` | `UInt32` | The relative weight of the shard when writing data. |
| `internal_replication` | `UInt8` | Flag that indicates whether this host is a part on ensemble which can replicate the data on its own. |
| `replica_num` | `UInt32` | The replica number in the shard, starting from 1. |
| `host_name` | `String` | The host name, as specified in the config. |
| `host_address` | `String` | The host IP address obtained from DNS. |
| `port` | `UInt16` | The port to use for connecting to the server. |
| `is_local` | `UInt8` | Flag that indicates whether the host is local. |
| `user` | `String` | The name of the user for connecting to the server. |
| `default_database` | `String` | The default database name. |
| `errors_count` | `UInt32` | The number of times this host failed to reach replica. |
| `slowdowns_count` | `UInt32` | The number of slowdowns that led to changing replica when establishing a connection with hedged requests. |
| `estimated_recovery_time` | `UInt32` | Seconds remaining until the replica error count is zeroed and it is considered to be back to normal. |
| `database_shard_name` | `String` | The name of the `Replicated` database shard (for clusters that belong to a `Replicated` database). |
| `database_replica_name` | `String` | The name of the `Replicated` database replica (for clusters that belong to a `Replicated` database). |
| `is_shared_catalog_cluster` | `UInt8` | Bool indicating if the cluster belongs to shared catalog. |
| `is_active` | `Nullable(UInt8)` | The status of the Replicated database replica (for clusters that belong to a Replicated database): 1 means 'replica is online', 0 means 'replica is offline', NULL means 'unknown'. |
| `unsynced_after_recovery` | `Nullable(UInt8)` | Indicates if a Replicated database replica has replication lag more than max_replication_lag_to_enqueue after creating or recovering the replica. |
| `replication_lag` | `Nullable(UInt32)` | The replication lag of the `Replicated` database replica (for clusters that belong to a Replicated database). |
| `recovery_time` | `Nullable(UInt64)` | The recovery time of the `Replicated` database replica (for clusters that belong to a Replicated database), in milliseconds. |
| `name` | `String` |  |

## system.mutations

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | The name of the database to which the mutation was applied. |
| `table` | `String` | The name of the table to which the mutation was applied. |
| `mutation_id` | `String` | The ID of the mutation. For replicated tables these IDs correspond to znode names in the `<table_path_in_clickhouse_keeper>/mutations/` directory in ClickHouse Keeper. For non-replicated tables the IDs correspond to file names in the data directory of the table. |
| `command` | `String` | The mutation command string (the part of the query after ALTER TABLE [db.]table). |
| `create_time` | `DateTime` | Date and time when the mutation command was submitted for execution. |
| `block_numbers.partition_id` | `Array(String)` | For mutations of replicated tables, the array contains the partitions' IDs (one record for each partition). For mutations of non-replicated tables the array is empty. |
| `block_numbers.number` | `Array(Int64)` | For mutations of replicated tables, the array contains one record for each partition, with the block number that was acquired by the mutation. Only parts that contain blocks with numbers less than this number will be mutated in the partition.In non-replicated tables, block numbers in all partitions… |
| `parts_in_progress_names` | `Array(String)` | An array of names of data parts that are currently being mutated. |
| `parts_to_do_names` | `Array(String)` | An array of names of data parts that need to be mutated for the mutation to complete. |
| `parts_to_do` | `Int64` | The number of data parts that need to be mutated for the mutation to complete. Note: even if `parts_to_do` = 0, a mutation of a replicated table may not be completed yet due to a long-running INSERT that is creating a new data part that will need to be mutated. |
| `parts_postpone_reasons` | `Map(String, String)` | A map of part names to reasons why they are postponed. |
| `is_done` | `UInt8` | The flag whether the mutation is done or not. Possible values: 1 if the mutation is completed, 0 if the mutation is still in process. |
| `is_killed` | `UInt8` | Indicates whether a mutation has been killed. Only available in ClickHouse Cloud.Note: is_killed=1 does not necessarily mean the mutation is completely finalized.It is possible for a mutation to remain in a state where is_killed=1 and is_done=0 for an extended period.This can occur if another long-… |
| `latest_failed_part` | `String` | The name of the most recent part that could not be mutated. |
| `latest_fail_time` | `DateTime` | The date and time of the most recent part mutation failure. |
| `latest_fail_reason` | `String` | The exception message that caused the most recent part mutation failure. |
| `latest_fail_error_code_name` | `String` | The error code of the exception that caused the most recent part mutation failure. |

## system.replication_queue

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | Name of the database. |
| `table` | `String` | Name of the table. |
| `replica_name` | `String` | Replica name in ClickHouse Keeper. Different replicas of the same table have different names. |
| `position` | `UInt32` | Position of the task in the queue. |
| `node_name` | `String` | Node name in ClickHouse Keeper. |
| `type` | `String` | Type of the task in the queue, one of: • GET_PART — Get the part from another replica, • ATTACH_PART — Attach the part, possibly from our own replica (if found in the detached folder). You may think of it as a GET_PART with some optimizations as they're nearly identical, • MERGE_PARTS — Merge the p… |
| `create_time` | `DateTime` | Date and time when the task was submitted for execution. |
| `required_quorum` | `UInt32` | The number of replicas waiting for the task to complete with confirmation of completion. This column is only relevant for the GET_PARTS task. |
| `source_replica` | `String` | Name of the source replica. |
| `new_part_name` | `String` | Name of the new part. |
| `parts_to_merge` | `Array(String)` | Names of parts to merge or update. |
| `is_detach` | `UInt8` | The flag indicates whether the DETACH_PARTS task is in the queue. |
| `is_currently_executing` | `UInt8` | The flag indicates whether a specific task is being performed right now. |
| `num_tries` | `UInt32` | The number of failed attempts to complete the task. |
| `last_exception` | `String` | Text message about the last error that occurred (if any). |
| `last_exception_time` | `DateTime` | Date and time when the last error occurred. |
| `last_attempt_time` | `DateTime` | Date and time when the task was last attempted. |
| `num_postponed` | `UInt32` | The number of times the action was postponed. |
| `postpone_reason` | `String` | The reason why the task was postponed. |
| `last_postpone_time` | `DateTime` | Date and time when the task was last postponed. |
| `merge_type` | `String` | Type of the current merge. Empty if it's a mutation. |

## system.dictionaries

| Column | Type | Description |
|--------|------|-------------|
| `database` | `String` | Name of the database containing the dictionary created by DDL query. Empty string for other dictionaries. |
| `name` | `String` | Dictionary name. |
| `uuid` | `UUID` | Dictionary UUID. |
| `status` | `Enum8('NOT_LOADED' = 0, 'LOADED' = 1, 'FAILED' = 2, 'LOADING' = 3, 'FAILED_AND_RELOADING' = 4, 'LOADED_AND_RELOADING' = 5, 'NOT_EXIST' = 6)` | Dictionary status. Possible values: NOT_LOADED — Dictionary was not loaded because it was not used, LOADED — Dictionary loaded successfully, FAILED — Unable to load the dictionary as a result of an error, LOADING — Dictionary is loading now, LOADED_AND_RELOADING — Dictionary is loaded successfully,… |
| `origin` | `String` | Path to the configuration file that describes the dictionary. |
| `type` | `String` | Type of a dictionary allocation. Storing Dictionaries in Memory. |
| `key.names` | `Array(String)` | Array of key names provided by the dictionary. |
| `key.types` | `Array(String)` | Corresponding array of key types provided by the dictionary. |
| `attribute.names` | `Array(String)` | Array of attribute names provided by the dictionary. |
| `attribute.types` | `Array(String)` | Corresponding array of attribute types provided by the dictionary. |
| `bytes_allocated` | `UInt64` | Amount of RAM allocated for the dictionary. |
| `hierarchical_index_bytes_allocated` | `UInt64` | Amount of RAM allocated for hierarchical index. |
| `query_count` | `UInt64` | Number of queries since the dictionary was loaded or since the last successful reboot. |
| `hit_rate` | `Float64` | For cache dictionaries, the percentage of uses for which the value was in the cache. |
| `found_rate` | `Float64` | The percentage of uses for which the value was found. |
| `element_count` | `UInt64` | Number of items stored in the dictionary. |
| `load_factor` | `Float64` | Percentage filled in the dictionary (for a hashed dictionary, the percentage filled in the hash table). |
| `source` | `String` | Text describing the data source for the dictionary. |
| `lifetime_min` | `UInt64` | Minimum lifetime of the dictionary in memory, after which ClickHouse tries to reload the dictionary (if invalidate_query is set, then only if it has changed). Set in seconds. |
| `lifetime_max` | `UInt64` | Maximum lifetime of the dictionary in memory, after which ClickHouse tries to reload the dictionary (if invalidate_query is set, then only if it has changed). Set in seconds. |
| `loading_start_time` | `DateTime` | Start time for loading the dictionary. |
| `last_successful_update_time` | `DateTime` | End time for loading or updating the dictionary. Helps to monitor some troubles with dictionary sources and investigate the causes. |
| `error_count` | `UInt64` | Number of errors since last successful loading. Helps to monitor some troubles with dictionary sources and investigate the causes. |
| `loading_duration` | `Float32` | Duration of a dictionary loading. |
| `last_exception` | `String` | Text of the error that occurs when creating or reloading the dictionary if the dictionary couldn't be created. |
| `comment` | `String` | Text of the comment to dictionary. |

## system.settings

| Column | Type | Description |
|--------|------|-------------|
| `name` | `String` | Setting name. |
| `value` | `String` | Setting value. |
| `changed` | `UInt8` | Shows whether the setting was explicitly defined in the config or explicitly changed. |
| `description` | `String` | Short setting description. |
| `min` | `Nullable(String)` | Minimum value of the setting, if any is set via constraints. If the setting has no minimum value, contains NULL. |
| `max` | `Nullable(String)` | Maximum value of the setting, if any is set via constraints. If the setting has no maximum value, contains NULL. |
| `disallowed_values` | `Array(String)` | List of disallowed values |
| `readonly` | `UInt8` | Shows whether the current user can change the setting: 0 — Current user can change the setting, 1 — Current user can't change the setting. |
| `type` | `String` | The type of the value that can be assigned to this setting. |
| `default` | `String` | Setting default value. |
| `alias_for` | `String` | The name of the original setting if the setting is an alias for another setting. |
| `is_obsolete` | `UInt8` | Shows whether a setting is obsolete. |
| `tier` | `Enum8('Production' = 0, 'Obsolete' = 4, 'Experimental' = 8, 'Beta' = 12)` | Support level for this feature. ClickHouse features are organized in tiers, varying depending on the current status of their development and the expectations one might have when using them: * PRODUCTION: The feature is stable, safe to use and does not have issues interacting with other PRODUCTION f… |

## system.metrics

| Column | Type | Description |
|--------|------|-------------|
| `metric` | `String` | Metric name. |
| `value` | `Int64` | Metric value. |
| `description` | `String` | Metric description. |
| `name` | `String` |  |

## system.events

| Column | Type | Description |
|--------|------|-------------|
| `event` | `String` | Event name. |
| `value` | `UInt64` | Number of events occurred. |
| `description` | `String` | Event description. |
| `name` | `String` |  |

