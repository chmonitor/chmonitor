---
title: ClickHouse Settings Tiers
version: "26.5.1.882"
---

# Experimental and Beta settings (ClickHouse 26.5.1.882)

Generated from `system.settings.tier`. Do not edit; regenerate with
`bun run scripts/build-ch-schema-docs.ts --live`. Experimental settings can
change or disappear without notice; do not rely on them in query configs.

## Experimental (93)

| Setting | Description |
|---------|-------------|
| `ai_function_max_api_calls_per_query` | Maximum number of HTTP requests that AI functions may dispatch per query. Set to 0 to disable. |
| `ai_function_max_input_tokens_per_query` | Maximum total input (prompt) tokens across all AI function API calls in a single query. Tracked cumulatively from provider responses. Note that this limit may be exceeded by one call's worth of input tokens, since the number of input tokens of a call are not known in advance. Set to 0 to disable. |
| `ai_function_max_output_tokens_per_query` | Maximum total output (completion) tokens across all AI function API calls in a single query. Tracked cumulatively from provider responses. Note that this limit may be exceeded by one call's worth of output tokens, since the number of output tokens of a call are not known in advance. Set to 0 to dis… |
| `ai_function_max_retries` | Maximum number of retry attempts for transient errors per individual API request. Each retry uses exponential backoff starting from `ai_function_retry_initial_delay_ms`. |
| `ai_function_request_timeout_sec` | Timeout in seconds for individual HTTP requests made by AI functions (AI chat completions and embedding API calls). If a request does not complete within this time, it is considered failed and may be retried according to `ai_function_max_retries`. |
| `ai_function_retry_initial_delay_ms` | Initial delay in milliseconds before the first retry of a failed AI function API request. The delay doubles on each subsequent attempt (exponential backoff). For example, with default settings: 1000ms, 2000ms, 4000ms. |
| `ai_function_throw_on_error` | If true (default), an AI function call that fails permanently after exhausting all retries aborts the query with an exception. If false, the failed row receives the default value for the column type (empty string for String) and processing continues. |
| `ai_function_throw_on_quota_exceeded` | If true (default), exceeding an AI function quota limit (`ai_function_max_input_tokens_per_query`, `ai_function_max_output_tokens_per_query`, or `ai_function_max_api_calls_per_query`) aborts the query with an exception. If false, remaining rows receive the default value for the column type (empty s… |
| `allow_experimental_ai_functions` | Enable experimental AI functions (e.g. `aiGenerateContent`). These functions make external HTTP calls to AI providers. |
| `allow_experimental_cleanup_old_data_files_compaction` | Allow to clean up old data files during Iceberg compaction. |
| `allow_experimental_codecs` | If it is set to true, allow to specify experimental compression codecs (but we don't have those yet and this option does nothing). |
| `allow_experimental_database_hms_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'hms' |
| `allow_experimental_database_materialized_postgresql` | Allow to create database with Engine=MaterializedPostgreSQL(...). |
| `allow_experimental_database_paimon_rest_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'paimon_rest' |
| `allow_experimental_delta_lake_writes` | Enables delta-kernel writes feature. |
| `allow_experimental_expire_snapshots` | Allow to execute experimental Iceberg command `ALTER TABLE ... EXECUTE expire_snapshots`. |
| `allow_experimental_funnel_functions` | Enable experimental functions for funnel analysis. |
| `allow_experimental_hash_functions` | Enable experimental hash functions |
| `allow_experimental_iceberg_compaction` | Allow to explicitly use 'OPTIMIZE' for iceberg tables. |
| `allow_experimental_join_right_table_sorting` | If it is set to true, and the conditions of `join_to_sort_minimum_perkey_rows` and `join_to_sort_maximum_table_rows` are met, rerange the right table by key to improve the performance in left or inner hash join. |
| `allow_experimental_json_lazy_type_hints` | Enable experimental lazy type hints for JSON type. This feature allows optimizing JSON type conversions by deferring type hint evaluation. |
| `allow_experimental_kafka_offsets_storage_in_keeper` | Allow experimental feature to store Kafka related offsets in ClickHouse Keeper. When enabled a ClickHouse Keeper path and replica name can be specified to the Kafka table engine. As a result instead of the regular Kafka engine, a new type of storage engine will be used that stores the committed off… |
| `allow_experimental_kusto_dialect` | Enable Kusto Query Language (KQL) - an alternative to SQL. |
| `allow_experimental_materialized_postgresql_table` | Allows to use the MaterializedPostgreSQL table engine. Disabled by default, because this feature is experimental |
| `allow_experimental_nlp_functions` | Enable experimental functions for natural language processing. |
| `allow_experimental_nullable_tuple_type` | Allows creation of [Nullable](../../sql-reference/data-types/nullable) [Tuple](../../sql-reference/data-types/tuple.md) columns in tables. |
| `allow_experimental_object_storage_queue_hive_partitioning` | Allow to use hive partitioning with S3Queue/AzureQueue engines |
| `allow_experimental_paimon_storage_engine` | Allow to create tables with Paimon* table engines. |
| `allow_experimental_polyglot_dialect` | Enable polyglot SQL transpiler - transpiles SQL from 30+ dialects (MySQL, PostgreSQL, SQLite, Snowflake, DuckDB, etc.) into ClickHouse SQL. |
| `allow_experimental_prql_dialect` | Enable PRQL - an alternative to SQL. |
| `allow_experimental_query_deduplication` | Experimental data deduplication for SELECT queries based on part UUIDs |
| `allow_experimental_time_series_aggregate_functions` | Experimental timeSeries* aggregate functions for Prometheus-like timeseries resampling, rate, delta calculation. |
| `allow_experimental_time_series_table` | Allows creation of tables with the [TimeSeries](../../engines/table-engines/integrations/time-series.md) table engine. Possible values: - 0 — the [TimeSeries](../../engines/table-engines/integrations/time-series.md) table engine is disabled. - 1 — the [TimeSeries](../../engines/table-engines/integr… |
| `allow_experimental_ts_to_grid_aggregate_function` | Experimental timeSeries* aggregate functions for Prometheus-like timeseries resampling, rate, delta calculation. |
| `allow_experimental_unique_key` | Allows creation of tables with the `UNIQUE KEY` clause on MergeTree-family engines. |
| `allow_experimental_window_view` | Enable WINDOW VIEW. Not mature enough. |
| `allow_experimental_ytsaurus_dictionary_source` | Experimental dictionary source for integration with YTsaurus. |
| `allow_experimental_ytsaurus_table_engine` | Experimental table engine for integration with YTsaurus. |
| `allow_experimental_ytsaurus_table_function` | Experimental table engine for integration with YTsaurus. |
| `allow_fuzz_query_functions` | Enables the `fuzzQuery` function that applies random AST mutations to a query string. |
| `allow_iceberg_remove_orphan_files` | Allow to use 'ALTER TABLE ... EXECUTE remove_orphan_files()' for iceberg tables. |
| `analyzer_inline_views` | When enabled, the analyzer substitutes ordinary (non-materialized, non-parameterized) views with their defining subqueries, enabling cross-boundary optimizations such as predicate pushdown and column pruning. |
| `ast_fuzzer_any_query` | When false (default), the server-side AST fuzzer (controlled by `ast_fuzzer_runs`) only fuzzes read-only queries (SELECT, EXPLAIN, SHOW, DESCRIBE, EXISTS). When true, all query types including DDL and INSERT are fuzzed. |
| `ast_fuzzer_runs` | Enables the server-side AST fuzzer that runs randomized queries after each normal query, discarding their results. - 0: disabled (default). - A value between 0 and 1 (exclusive): probability of running a single fuzzed query. - A value >= 1: the number of fuzzed queries to run per normal query. |
| `automatic_parallel_replicas_min_bytes_per_replica` | Threshold of bytes to read per replica to enable parallel replicas automatically (applies only when `automatic_parallel_replicas_mode`=1). 0 means no threshold. The total number of bytes to read is estimated based on the collected statistics. |
| `automatic_parallel_replicas_mode` | Enable automatic switching to execution with parallel replicas based on collected statistics. Requires `enable_analyzer = 1`, `enable_parallel_replicas != 0`, `parallel_replicas_local_plan = 1` and providing `cluster_for_parallel_replicas`. 0 - disabled, 1 - enabled, 2 - only statistics collection… |
| `distributed_index_analysis` | Index analysis will be distributed across replicas. Beneficial for shared storage and huge amount of data in cluster. Uses replicas from cluster_for_parallel_replicas. |
| `distributed_plan_default_reader_bucket_count` | Default number of tasks for parallel reading in distributed query. Tasks are spread across between replicas. |
| `distributed_plan_default_shuffle_join_bucket_count` | Default number of buckets for distributed shuffle-hash-join. |
| `distributed_plan_execute_locally` | Run all tasks of a distributed query plan locally. Useful for testing and debugging. |
| `distributed_plan_force_exchange_kind` | Force specified kind of Exchange operators between distributed query stages. |
| `distributed_plan_force_shuffle_aggregation` | Use Shuffle aggregation strategy instead of PartialAggregation + Merge in distributed query plan. |
| `distributed_plan_max_rows_to_broadcast` | Maximum rows to use broadcast join instead of shuffle join in distributed query plan. |
| `distributed_plan_prefer_replicas_over_workers` | Serialize the distributed query plan for execution at replicas. |
| `enable_adaptive_memory_spill_scheduler` | Trigger processor to spill data into external storage adpatively. grace join is supported at present. |
| `enable_join_transitive_predicates` | Infer transitive equi-join predicates from existing join conditions. For example, given `A.x = B.x` and `B.x = C.x`, a synthetic `A.x = C.x` predicate is added so the join order optimizer can consider direct (A JOIN C) plans. |
| `enable_materialized_cte` | Enable materialized common table expressions, it will be preferred over enable_global_with_statement |
| `evaluation_time` | Sets the evaluation time to be used with promql dialect. 'auto' means the current time. |
| `grace_hash_join_initial_buckets` | Initial number of grace hash join buckets |
| `grace_hash_join_max_buckets` | Limit on the number of grace hash join buckets |
| `iceberg_metadata_compression_method` | Method to compress `.metadata.json` file. |
| `iceberg_orphan_files_older_than_seconds` | Default age threshold in seconds for orphan file removal in Iceberg tables. Files newer than this are not considered orphans. Used when the older_than argument is omitted from the remove_orphan_files() procedure call. Default is 259200 (3 days). |
| `implicit_transaction` | If enabled and not already inside a transaction, wraps the query inside a full transaction (begin + commit or rollback) |
| `join_runtime_bloom_filter_bytes` | Size in bytes of a bloom filter used as JOIN runtime filter (see enable_join_runtime_filters setting). |
| `join_runtime_bloom_filter_hash_functions` | Number of hash functions in a bloom filter used as JOIN runtime filter (see enable_join_runtime_filters setting). |
| `join_runtime_bloom_filter_max_ratio_of_set_bits` | If the number of set bits in a runtime bloom filter exceeds this ratio the filter is completely disabled to reduce the overhead. |
| `join_runtime_filter_blocks_to_skip_before_reenabling` | Number of blocks that are skipped before trying to dynamically re-enable a runtime filter that previously was disabled due to poor filtering ratio. |
| `join_runtime_filter_exact_values_limit` | Maximum number of elements in runtime filter that are stored as is in a set, when this threshold is exceeded it switches to bloom filter. |
| `join_runtime_filter_pass_ratio_threshold_for_disabling` | If ratio of passed rows to checked rows is greater than this threshold the runtime filter is considered as poorly performing and is disabled for the next `join_runtime_filter_blocks_to_skip_before_reenabling` blocks to reduce the overhead. |
| `join_to_sort_maximum_table_rows` | The maximum number of rows in the right table to determine whether to rerange the right table by key in left or inner join. |
| `join_to_sort_minimum_perkey_rows` | The lower limit of per-key average rows in the right table to determine whether to rerange the right table by key in left or inner join. This setting ensures that the optimization is not applied for sparse table keys |
| `make_distributed_plan` | Make distributed query plan. |
| `max_consume_snapshots` | Maximum number of Paimon snapshots to consume per incremental read. 0 means no limit. |
| `paimon_target_snapshot_id` | Query-level targeted snapshot read for Paimon incremental mode. When >0, the reader will only fetch the delta for the specified snapshot_id without advancing the committed watermark. Default: -1 (disabled) |
| `polyglot_dialect` | Source SQL dialect for the polyglot transpiler (e.g. 'sqlite', 'mysql', 'postgresql', 'snowflake', 'duckdb'). |
| `promql_database` | Specifies the database name used by the 'promql' dialect. Empty string means the current database. |
| `promql_evaluation_time` | Sets the evaluation time to be used with promql dialect. 'auto' means the current time. |
| `promql_table` | Specifies the name of a TimeSeries table used by the 'promql' dialect. |
| `query_plan_optimize_join_order_algorithm` | Specifies which JOIN order algorithms to attempt during query plan optimization. The following algorithms are available: - 'greedy' - basic greedy algorithm - works fast but might not produce the best join order - 'dpsize' - implements DPsize algorithm currently only for Inner joins - considers all… |
| `query_plan_optimize_join_order_randomize` | When non-zero, the join order optimizer uses randomly generated cardinalities and NDVs instead of real statistics. When set to 1, a random seed is generated, when set to a value > 1, that value is used as the seed directly. This is intended for testing to find errors caused by different join orderi… |
| `rewrite_in_to_join` | Rewrite expressions like 'x IN subquery' to JOIN. This might be useful for optimizing the whole query with join reordering. |
| `stop_refreshable_materialized_views_on_startup` | On server startup, prevent scheduling of refreshable materialized views, as if with SYSTEM STOP VIEWS. You can manually start them with `SYSTEM START VIEWS` or `SYSTEM START VIEW <name>` afterwards. Also applies to newly created views. Has no effect on non-refreshable materialized views. |
| `throw_on_unsupported_query_inside_transaction` | Throw exception if unsupported query is used inside transaction |
| `use_paimon_partition_pruning` | Use Paimon partition pruning for Paimon table functions |
| `wait_changes_become_visible_after_commit_mode` | Wait for committed changes to become actually visible in the latest snapshot |
| `wait_for_window_view_fire_signal_timeout` | Timeout for waiting for window view fire signal in event time processing |
| `webassembly_udf_max_fuel` | Fuel limit per WebAssembly UDF instance execution. Each WebAssembly instruction consumes some amount of fuel. Set to 0 for no limit. |
| `webassembly_udf_max_input_block_size` | Maximum number of rows passed to a WebAssembly UDF in a single block. Set to 0 to process all rows at once. |
| `webassembly_udf_max_instances` | Maximum number of WebAssembly UDF instances that can run in parallel per function. |
| `webassembly_udf_max_memory` | Memory limit in bytes per WebAssembly UDF instance. |
| `window_view_clean_interval` | The clean interval of window view in seconds to free outdated data. |
| `window_view_heartbeat_interval` | The heartbeat interval in seconds to indicate watch query is alive. |
| `write_full_path_in_iceberg_metadata` | Write full paths (including s3://) into iceberg metadata files. |

## Beta (23)

| Setting | Description |
|---------|-------------|
| `allow_database_glue_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'glue' |
| `allow_database_iceberg` | Allow experimental database engine DataLakeCatalog with catalog_type = 'iceberg' |
| `allow_database_unity_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'unity' |
| `allow_experimental_correlated_subqueries` | Allow to execute correlated subqueries. |
| `allow_experimental_database_glue_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'glue' |
| `allow_experimental_database_iceberg` | Allow experimental database engine DataLakeCatalog with catalog_type = 'iceberg' |
| `allow_experimental_database_unity_catalog` | Allow experimental database engine DataLakeCatalog with catalog_type = 'unity' |
| `allow_experimental_delta_kernel_rs` | Allow experimental delta-kernel-rs implementation. |
| `allow_experimental_insert_into_iceberg` | Allow to execute `insert` queries into iceberg. |
| `allow_experimental_lightweight_update` | Allow to use lightweight updates. |
| `allow_insert_into_iceberg` | Allow to execute `insert` queries into iceberg. |
| `enable_join_runtime_filters` | Filter left side by set of JOIN keys collected from the right side at runtime. |
| `enable_lightweight_update` | Allow to use lightweight updates. |
| `geotoh3_argument_order` | Function 'geoToH3' accepts (lon, lat) if set to 'lon_lat' and (lat, lon) if set to 'lat_lon'. |
| `low_priority_query_wait_time_ms` | When the query prioritization mechanism is employed (see setting `priority`), low-priority queries wait for higher-priority queries to finish. This setting specifies the duration of waiting. |
| `parallel_replica_offset` | This is internal setting that should not be used directly and represents an implementation detail of the 'parallel replicas' mode. This setting will be automatically set up by the initiator server for distributed queries to the index of the replica participating in query processing among parallel r… |
| `parallel_replicas_allow_view_over_mergetree` | Allow parallel replicas to execute the outer query of a simple view over `MergeTree` tables (instead of the view's inner query), improving parallelization across nodes. Also applies to `UNION ALL` views whose branches all read from different `MergeTree` tables. |
| `parallel_replicas_count` | This is internal setting that should not be used directly and represents an implementation detail of the 'parallel replicas' mode. This setting will be automatically set up by the initiator server for distributed queries to the number of parallel replicas participating in query processing. |
| `parallel_replicas_custom_key` | An arbitrary integer expression that can be used to split work between replicas for a specific table. The value can be any integer expression. |
| `parallel_replicas_custom_key_range_lower` | Allows the filter type `range` to split the work evenly between replicas based on the custom range `[parallel_replicas_custom_key_range_lower, INT_MAX]`. |
| `parallel_replicas_custom_key_range_upper` | Allows the filter type `range` to split the work evenly between replicas based on the custom range `[0, parallel_replicas_custom_key_range_upper]`. A value of 0 disables the upper bound, setting it the max value of the custom key expression. |
| `parallel_replicas_filter_pushdown` | Allow pushing down filters to part of query which parallel replicas choose to execute |
| `session_timezone` | Sets the implicit time zone of the current session or query. The implicit time zone is the time zone applied to values of type DateTime/DateTime64 which have no explicitly specified time zone. The setting takes precedence over the globally configured (server-level) implicit time zone. A value of ''… |

