import type { QueryConfig } from '@/types/query-config'

export const explorerDatabaseDependenciesConfig: QueryConfig = {
  name: 'explorer-database-dependencies',
  description: 'All table dependencies within a database',
  sql: `
    WITH
      -- Get all tables with their dependencies
      table_deps AS (
        SELECT
          database,
          name,
          engine,
          dependencies_database,
          dependencies_table
        FROM system.tables
        WHERE database = {database:String}
          AND is_temporary = 0
          AND name NOT LIKE '.inner_%'
      ),
      -- Expand dependencies
      expanded AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          arrayJoin(
            if(empty(dependencies_database), [''], dependencies_database)
          ) AS target_database,
          arrayJoin(
            if(empty(dependencies_table), [''], dependencies_table)
          ) AS target_table
        FROM table_deps
      )
    SELECT DISTINCT
      source_database,
      source_table,
      source_engine,
      target_database,
      target_table
    FROM expanded
    WHERE target_table != ''
      OR source_engine IN ('MaterializedView', 'View', 'Dictionary')
    ORDER BY source_table, target_table
  `,
  columns: [
    'source_database',
    'source_table',
    'source_engine',
    'target_database',
    'target_table',
  ],
  defaultParams: { database: 'default' },
}

export const explorerDictionarySourceConfig: QueryConfig = {
  name: 'explorer-dictionary-source',
  description: 'Source table for a dictionary',
  sql: `
    SELECT
        database AS dict_database,
        name AS dict_name,
        source,
        -- Extract source database from ClickHouse source string
        extractAllGroups(source, 'db: ''([^'']+)''')[1][1] AS source_database,
        -- Extract source table from ClickHouse source string
        extractAllGroups(source, 'table: ''([^'']+)''')[1][1] AS source_table
    FROM system.dictionaries
    WHERE database = {database:String}
      AND name = {table:String}
  `,
  columns: [
    'dict_database',
    'dict_name',
    'source',
    'source_database',
    'source_table',
  ],
  defaultParams: { database: 'default', table: '' },
}

export const explorerDependenciesDownstreamConfig: QueryConfig = {
  name: 'explorer-dependencies-downstream',
  description: 'Tables and views that depend on this table (downstream)',
  sql: `
    SELECT
        database AS dependent_database,
        name AS dependent_table,
        engine,
        if(engine = 'MaterializedView', 'Materialized View',
           if(engine = 'View', 'View', 'Table')) AS type,
        create_table_query
    FROM system.tables
    WHERE has(dependencies_database, {database:String})
      AND has(dependencies_table, {table:String})
    ORDER BY database, name
  `,
  columns: [
    'dependent_database',
    'dependent_table',
    'engine',
    'type',
    'create_table_query',
  ],
  defaultParams: { database: 'default', table: '' },
}

export const explorerDependenciesUpstreamConfig: QueryConfig = {
  name: 'explorer-dependencies-upstream',
  description: 'Tables that this table depends on (upstream)',
  sql: `
    SELECT
        dep_db AS source_database,
        dep_table AS source_table,
        st.engine,
        if(st.engine = 'MaterializedView', 'Materialized View',
           if(st.engine = 'View', 'View', 'Table')) AS type
    FROM (
        SELECT
            arrayJoin(dependencies_database) AS dep_db,
            arrayJoin(dependencies_table) AS dep_table
        FROM system.tables
        WHERE database = {database:String}
          AND name = {table:String}
    ) AS deps
    LEFT JOIN system.tables AS st ON st.database = deps.dep_db AND st.name = deps.dep_table
    ORDER BY source_database, source_table
  `,
  columns: ['source_database', 'source_table', 'engine', 'type'],
  defaultParams: { database: 'default', table: '' },
}

export const explorerAllDependenciesConfig: QueryConfig = {
  name: 'explorer-all-dependencies',
  description:
    'All dependencies within a database including dictGet, joinGet, MV targets',
  sql: `
    WITH
      -- 1. Standard dependencies from system.tables arrays
      standard_deps AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dependency' AS dependency_type,
          dep_db AS target_database,
          dep_table AS target_table,
          '' AS extra_info
        FROM system.tables
        ARRAY JOIN
          dependencies_database AS dep_db,
          dependencies_table AS dep_table
        WHERE database = {database:String}
          AND is_temporary = 0
          AND name NOT LIKE '.inner_%'
      ),

      -- 2. dictGet() usage in table definitions
      dictget_deps AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dictGet' AS dependency_type,
          if(position(dict_ref, '.') > 0, splitByChar('.', dict_ref)[1], database) AS target_database,
          if(position(dict_ref, '.') > 0, splitByChar('.', dict_ref)[2], dict_ref) AS target_table,
          dict_ref AS extra_info
        FROM (
          SELECT database, name, engine, create_table_query,
            arrayJoin(extractAll(create_table_query, 'dictGet[a-zA-Z]*\\s*\\(\\s*''([^'']+)''')) AS dict_ref
          FROM system.tables
          WHERE database = {database:String}
            AND is_temporary = 0
            AND create_table_query LIKE '%dictGet%'
        )
        WHERE dict_ref != ''
      ),

      -- 3. joinGet() usage
      joinget_deps AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'joinGet' AS dependency_type,
          if(position(join_ref, '.') > 0, splitByChar('.', join_ref)[1], database) AS target_database,
          if(position(join_ref, '.') > 0, splitByChar('.', join_ref)[2], join_ref) AS target_table,
          join_ref AS extra_info
        FROM (
          SELECT database, name, engine, create_table_query,
            arrayJoin(extractAll(create_table_query, 'joinGet\\s*\\(\\s*''([^'']+)''')) AS join_ref
          FROM system.tables
          WHERE database = {database:String}
            AND is_temporary = 0
            AND create_table_query LIKE '%joinGet%'
        )
        WHERE join_ref != ''
      ),

      -- 4. MV TO targets (MV writes to a different table)
      mv_targets AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'mv_target' AS dependency_type,
          if(position(mv_target, '.') > 0, splitByChar('.', mv_target)[1], database) AS target_database,
          if(position(mv_target, '.') > 0, splitByChar('.', mv_target)[2], mv_target) AS target_table,
          'writes_to' AS extra_info
        FROM (
          SELECT database, name, engine, create_table_query,
            extract(create_table_query, 'TO\\s+\`?([a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)?)\`?\\s+') AS mv_target
          FROM system.tables
          WHERE database = {database:String}
            AND engine = 'MaterializedView'
            AND create_table_query LIKE '% TO %'
        )
        WHERE mv_target != ''
      ),

      -- 5. Dictionary sources (from system.dictionaries)
      dict_sources AS (
        SELECT
          database AS source_database,
          name AS source_table,
          'Dictionary' AS source_engine,
          'dict_source' AS dependency_type,
          coalesce(extractAllGroups(source, 'db:\\s*''([^'']+)''')[1][1], database) AS target_database,
          extractAllGroups(source, 'table:\\s*''([^'']+)''')[1][1] AS target_table,
          source AS extra_info
        FROM system.dictionaries
        WHERE database = {database:String}
          AND extractAllGroups(source, 'table:\\s*''([^'']+)''')[1][1] != ''
      ),

      -- 6. External engines (standalone nodes for display)
      external_engines AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'external' AS dependency_type,
          '' AS target_database,
          '' AS target_table,
          engine_full AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND engine IN ('PostgreSQL', 'MySQL', 'S3', 'Kafka', 'MongoDB', 'HDFS', 'URL', 'ODBC', 'JDBC')
      ),

      -- 7. Standalone tables (no dependencies but should appear in graph)
      standalone_tables AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          '' AS dependency_type,
          '' AS target_database,
          '' AS target_table,
          '' AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND is_temporary = 0
          AND name NOT LIKE '.inner_%'
          AND length(dependencies_table) = 0
          AND engine NOT IN ('PostgreSQL', 'MySQL', 'S3', 'Kafka', 'MongoDB', 'HDFS', 'URL', 'ODBC', 'JDBC')
      )

    SELECT * FROM standard_deps
    UNION ALL SELECT * FROM dictget_deps
    UNION ALL SELECT * FROM joinget_deps
    UNION ALL SELECT * FROM mv_targets
    UNION ALL SELECT * FROM dict_sources
    UNION ALL SELECT * FROM external_engines
    UNION ALL SELECT * FROM standalone_tables
    ORDER BY source_table, dependency_type, target_table
  `,
  columns: [
    'source_database',
    'source_table',
    'source_engine',
    'dependency_type',
    'target_database',
    'target_table',
    'extra_info',
  ],
  defaultParams: { database: 'default' },
}

export const explorerTableDependenciesConfig: QueryConfig = {
  name: 'explorer-table-dependencies',
  description:
    'All dependencies for a specific table including dictGet, joinGet, MV targets',
  sql: `
    WITH
      -- 1. Standard dependencies from system.tables arrays (where source is our table)
      standard_deps_out AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dependency' AS dependency_type,
          dep_db AS target_database,
          dep_table AS target_table,
          '' AS extra_info
        FROM system.tables
        ARRAY JOIN
          dependencies_database AS dep_db,
          dependencies_table AS dep_table
        WHERE database = {database:String}
          AND name = {table:String}
      ),

      -- 1b. Standard dependencies (where target is our table)
      standard_deps_in AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dependency' AS dependency_type,
          {database:String} AS target_database,
          {table:String} AS target_table,
          '' AS extra_info
        FROM system.tables
        WHERE has(dependencies_database, {database:String})
          AND has(dependencies_table, {table:String})
      ),

      -- 2. dictGet() usage in table definitions (where source is our table)
      dictget_deps_out AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dictGet' AS dependency_type,
          if(position(dict_ref, '.') > 0, splitByChar('.', dict_ref)[1], database) AS target_database,
          if(position(dict_ref, '.') > 0, splitByChar('.', dict_ref)[2], dict_ref) AS target_table,
          dict_ref AS extra_info
        FROM (
          SELECT database, name, engine,
            arrayJoin(extractAll(create_table_query, 'dictGet[a-zA-Z]*\\s*\\(\\s*''([^'']+)''')) AS dict_ref
          FROM system.tables
          WHERE database = {database:String}
            AND name = {table:String}
            AND create_table_query LIKE '%dictGet%'
        )
        WHERE dict_ref != ''
      ),

      -- 2b. dictGet() usage (where target dictionary is our table - i.e., what uses this dict)
      dictget_deps_in AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'dictGet' AS dependency_type,
          {database:String} AS target_database,
          {table:String} AS target_table,
          {table:String} AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND is_temporary = 0
          AND (
            create_table_query LIKE concat('%dictGet%''', {table:String}, '''%')
            OR create_table_query LIKE concat('%dictGet%''', {database:String}, '.', {table:String}, '''%')
          )
      ),

      -- 3. joinGet() usage (where source is our table)
      joinget_deps_out AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'joinGet' AS dependency_type,
          if(position(join_ref, '.') > 0, splitByChar('.', join_ref)[1], database) AS target_database,
          if(position(join_ref, '.') > 0, splitByChar('.', join_ref)[2], join_ref) AS target_table,
          join_ref AS extra_info
        FROM (
          SELECT database, name, engine,
            arrayJoin(extractAll(create_table_query, 'joinGet\\s*\\(\\s*''([^'']+)''')) AS join_ref
          FROM system.tables
          WHERE database = {database:String}
            AND name = {table:String}
            AND create_table_query LIKE '%joinGet%'
        )
        WHERE join_ref != ''
      ),

      -- 4. MV TO targets (if this is an MV that writes TO a table)
      mv_targets AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'mv_target' AS dependency_type,
          if(position(mv_target, '.') > 0, splitByChar('.', mv_target)[1], database) AS target_database,
          if(position(mv_target, '.') > 0, splitByChar('.', mv_target)[2], mv_target) AS target_table,
          'writes_to' AS extra_info
        FROM (
          SELECT database, name, engine,
            extract(create_table_query, 'TO\\s+\`?([a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)?)\`?\\s+') AS mv_target
          FROM system.tables
          WHERE database = {database:String}
            AND name = {table:String}
            AND engine = 'MaterializedView'
            AND create_table_query LIKE '% TO %'
        )
        WHERE mv_target != ''
      ),

      -- 4b. MV TO targets (MVs that write TO this table)
      mv_targets_in AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'mv_target' AS dependency_type,
          {database:String} AS target_database,
          {table:String} AS target_table,
          'writes_to' AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND engine = 'MaterializedView'
          AND (
            create_table_query LIKE concat('% TO ', {table:String}, ' %')
            OR create_table_query LIKE concat('% TO \`', {table:String}, '\` %')
            OR create_table_query LIKE concat('% TO ', {database:String}, '.', {table:String}, ' %')
          )
      ),

      -- 5. Dictionary source (if this is a dictionary)
      dict_sources AS (
        SELECT
          database AS source_database,
          name AS source_table,
          'Dictionary' AS source_engine,
          'dict_source' AS dependency_type,
          coalesce(extractAllGroups(source, 'db:\\s*''([^'']+)''')[1][1], database) AS target_database,
          extractAllGroups(source, 'table:\\s*''([^'']+)''')[1][1] AS target_table,
          source AS extra_info
        FROM system.dictionaries
        WHERE database = {database:String}
          AND name = {table:String}
          AND extractAllGroups(source, 'table:\\s*''([^'']+)''')[1][1] != ''
      ),

      -- 6. External engine info (if this is an external table)
      external_engines AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          'external' AS dependency_type,
          '' AS target_database,
          '' AS target_table,
          engine_full AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND name = {table:String}
          AND engine IN ('PostgreSQL', 'MySQL', 'S3', 'Kafka', 'MongoDB', 'HDFS', 'URL', 'ODBC', 'JDBC')
      ),

      -- 7. Current table as standalone (if no other deps found)
      current_table AS (
        SELECT
          database AS source_database,
          name AS source_table,
          engine AS source_engine,
          '' AS dependency_type,
          '' AS target_database,
          '' AS target_table,
          '' AS extra_info
        FROM system.tables
        WHERE database = {database:String}
          AND name = {table:String}
      )

    SELECT DISTINCT * FROM (
      SELECT * FROM standard_deps_out
      UNION ALL SELECT * FROM standard_deps_in
      UNION ALL SELECT * FROM dictget_deps_out
      UNION ALL SELECT * FROM dictget_deps_in
      UNION ALL SELECT * FROM joinget_deps_out
      UNION ALL SELECT * FROM mv_targets
      UNION ALL SELECT * FROM mv_targets_in
      UNION ALL SELECT * FROM dict_sources
      UNION ALL SELECT * FROM external_engines
      UNION ALL SELECT * FROM current_table
    )
    ORDER BY source_table, dependency_type, target_table
  `,
  columns: [
    'source_database',
    'source_table',
    'source_engine',
    'dependency_type',
    'target_database',
    'target_table',
    'extra_info',
  ],
  defaultParams: { database: 'default', table: '' },
}
