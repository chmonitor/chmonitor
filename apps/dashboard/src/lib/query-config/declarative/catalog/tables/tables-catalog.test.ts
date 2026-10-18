/**
 * Snapshot tests for the tables/ declarative catalog (Plan 02d).
 *
 * For each migrated config, we verify that loadDeclarativeConfig() round-trips
 * the declarative object back to a QueryConfig that deep-equals the legacy TS
 * config on every serializable field.
 *
 * Runtime-only fields absent from DeclarativeQueryConfig are excluded from
 * comparison: columnIcons, rowClassName, expandable, permission, filterSchema,
 * columnFilters, variants.
 *
 * SKIPPED configs (non-serializable fields block migration):
 *   - readonly-tables  : expandable contains JSX (React component ref)
 */

import { loadDeclarativeConfig } from '../../loader'
import { detachedPartsDeclarative } from './detached-parts'
import { distributedDdlQueueDeclarative } from './distributed-ddl-queue'
import { droppedTablesDeclarative } from './dropped-tables'
import { movesDeclarative } from './moves'
import { partInfoDeclarative } from './part-info'
import { projectionsDeclarative } from './projections'
import { replicasDeclarative } from './replicas'
import { replicatedFetchesDeclarative } from './replicated-fetches'
import { replicationQueueDeclarative } from './replication-queue'
import { tablesOverviewDeclarative } from './tables-overview'
import { userProcessesDeclarative } from './user-processes'
import { viewRefreshesDeclarative } from './view-refreshes'
import { describe, expect, test } from 'bun:test'
import { detachedPartsConfig } from '@/lib/query-config/tables/detached-parts'
import { distributedDdlQueueConfig } from '@/lib/query-config/tables/distributed-ddl-queue'
import { droppedTablesConfig } from '@/lib/query-config/tables/dropped-tables'
import { movesConfig } from '@/lib/query-config/tables/moves'
import { partInfoConfig } from '@/lib/query-config/tables/part-info'
import { projectionsConfig } from '@/lib/query-config/tables/projections'
import { replicasConfig } from '@/lib/query-config/tables/replicas'
import { replicatedFetchesConfig } from '@/lib/query-config/tables/replicated-fetches'
import { replicationQueueConfig } from '@/lib/query-config/tables/replication-queue'
import { tablesOverviewConfig } from '@/lib/query-config/tables/tables-overview'
import { userProcessesConfig } from '@/lib/query-config/tables/user-processes'
import { viewRefreshesConfig } from '@/lib/query-config/tables/view-refreshes'

// ---------------------------------------------------------------------------
// Helper: extract only the serializable fields from a QueryConfig for
// comparison. Serializable = fields present in DeclarativeQueryConfig schema.
// ---------------------------------------------------------------------------

const SERIALIZABLE_KEYS = [
  'name',
  'description',
  'docs',
  'suggestion',
  'sql',
  'columns',
  'columnFormats',
  'columnDescriptions',
  'columnSizing',
  'tableBehavior',
  'defaultParams',
  'filterParamPresets',
  'optional',
  'tableCheck',
  'disableSqlValidation',
  'refreshInterval',
  'relatedCharts',
  'card',
  'defaultView',
  'bulkActions',
  'bulkActionKey',
  'sortingFns',
  'clickhouseSettings',
] as const

type SerializableKey = (typeof SERIALIZABLE_KEYS)[number]

function pickSerializable(
  config: Record<string, unknown>
): Partial<Record<SerializableKey, unknown>> {
  const result: Partial<Record<SerializableKey, unknown>> = {}
  for (const key of SERIALIZABLE_KEYS) {
    if (key in config) {
      result[key] = config[key]
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Parametric test helper
// ---------------------------------------------------------------------------

function assertDeclarativeMatchesLegacy(
  declarative: unknown,
  legacy: Record<string, unknown>,
  configName: string
) {
  describe(`${configName} — declarative catalog`, () => {
    test('loadDeclarativeConfig succeeds', () => {
      expect(() => loadDeclarativeConfig(declarative)).not.toThrow()
    })

    test('deep-equals legacy config on serializable fields', () => {
      const loaded = loadDeclarativeConfig(declarative) as unknown as Record<
        string,
        unknown
      >
      const legacySerializable = pickSerializable(legacy)

      for (const [key, value] of Object.entries(legacySerializable)) {
        expect(loaded[key]).toEqual(value)
      }
    })

    test('name matches', () => {
      const loaded = loadDeclarativeConfig(declarative) as unknown as Record<
        string,
        unknown
      >
      expect(loaded.name).toBe(legacy.name)
    })

    test('sql matches', () => {
      const loaded = loadDeclarativeConfig(declarative) as unknown as Record<
        string,
        unknown
      >
      expect(loaded.sql).toEqual(legacy.sql)
    })

    test('columns match', () => {
      const loaded = loadDeclarativeConfig(declarative) as unknown as Record<
        string,
        unknown
      >
      expect(loaded.columns).toEqual(legacy.columns)
    })
  })
}

// ---------------------------------------------------------------------------
// detached-parts
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  detachedPartsDeclarative,
  detachedPartsConfig as unknown as Record<string, unknown>,
  'detached-parts'
)

// ---------------------------------------------------------------------------
// distributed-ddl-queue
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  distributedDdlQueueDeclarative,
  distributedDdlQueueConfig as unknown as Record<string, unknown>,
  'distributed-ddl-queue'
)

// #3919: without Keeper, system.distributed_ddl_queue exists but reading it
// fails with NO_ELEMENTS_IN_CONFIG. Gating on system.zookeeper (attached only
// with Keeper) makes the route answer "unavailable" instead of a 500.
test('distributed-ddl-queue requires system.zookeeper', () => {
  for (const tableCheck of [
    distributedDdlQueueConfig.tableCheck,
    distributedDdlQueueDeclarative.tableCheck,
  ]) {
    expect(tableCheck).toContain('system.zookeeper')
  }
})

// ---------------------------------------------------------------------------
// dropped-tables
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  droppedTablesDeclarative,
  droppedTablesConfig as unknown as Record<string, unknown>,
  'dropped-tables'
)

// ---------------------------------------------------------------------------
// moves
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  movesDeclarative,
  movesConfig as unknown as Record<string, unknown>,
  'moves'
)

// ---------------------------------------------------------------------------
// replicas
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  replicasDeclarative,
  replicasConfig as unknown as Record<string, unknown>,
  'replicas'
)

// ---------------------------------------------------------------------------
// replicated-fetches
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  replicatedFetchesDeclarative,
  replicatedFetchesConfig as unknown as Record<string, unknown>,
  'replicated-fetches'
)

// ---------------------------------------------------------------------------
// replication-queue
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  replicationQueueDeclarative,
  replicationQueueConfig as unknown as Record<string, unknown>,
  'replication-queue'
)

// ---------------------------------------------------------------------------
// view-refreshes
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  viewRefreshesDeclarative,
  viewRefreshesConfig as unknown as Record<string, unknown>,
  'view-refreshes'
)

// ---------------------------------------------------------------------------
// part-info
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  partInfoDeclarative,
  partInfoConfig as unknown as Record<string, unknown>,
  'part-info'
)

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  projectionsDeclarative,
  projectionsConfig as unknown as Record<string, unknown>,
  'projections'
)

// ---------------------------------------------------------------------------
// user-processes
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  userProcessesDeclarative,
  userProcessesConfig as unknown as Record<string, unknown>,
  'user-processes'
)

// ---------------------------------------------------------------------------
// tables-overview (clickhouseSettings now serializable via schema-ext)
// ---------------------------------------------------------------------------

assertDeclarativeMatchesLegacy(
  tablesOverviewDeclarative,
  tablesOverviewConfig as unknown as Record<string, unknown>,
  'tables-overview'
)
