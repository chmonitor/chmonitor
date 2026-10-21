/**
 * Snapshot tests for the more/ domain declarative catalog (Plan 02f).
 *
 * For each migrated config, assert that loadDeclarativeConfig(declarativeObj)
 * deep-equals the legacy TS config on its serializable fields.
 *
 * Runtime-only fields excluded from comparison:
 *   rowClassName  — function (row) => string | undefined
 *   expandable    — function-based ExpandableConfig
 *   columnIcons   — React component refs
 *   filterSchema  — contains Icon refs and dynamic option fns
 *
 * docs (table-missing help text) and permission (FeaturePermission as plain
 * data) are now serializable and ARE compared here.
 *
 * settings/users now migrate too: their factory-based `expandable` is expressed
 * via the declarative `expandable` config-details spec. The compiled
 * renderExpanded is a function (not deep-equalled by compareSerializable); a
 * dedicated behavioral test asserts it binds the same factory + primaryColumns
 * as the legacy config.
 *
 * Skipped configs (runtime-only fields that the schema cannot express):
 *   page-views — tableCheck + SQL reference runtime EVENTS_TABLE env var
 */

import type { ExpandableConfig } from '@/types/query-config'

import { loadDeclarativeConfig } from '../../loader'
// Declarative catalog objects
import { asynchronousMetricsDeclarative } from './asynchronous-metrics'
import { backupsDeclarative } from './backups'
import { dictionariesDeclarative } from './dictionaries'
import { errorsDeclarative } from './errors'
import { mergeTreeSettingsDeclarative } from './mergetree-settings'
import { metricsDeclarative } from './metrics'
import { rolesDeclarative } from './roles'
import { settingsDeclarative } from './settings'
import { topUsageColumnsDeclarative } from './top-usage-columns'
import { topUsageTablesDeclarative } from './top-usage-tables'
import { unusedColumnsDeclarative } from './unused-columns'
import { unusedProjectionsDeclarative } from './unused-projections'
import { unusedTablesDeclarative } from './unused-tables'
import { usersDeclarative } from './users'
import { zookeeperDeclarative } from './zookeeper'
import { describe, expect, test } from 'bun:test'
// Legacy TS configs
import { asynchronousMetricsConfig } from '@/lib/query-config/more/asynchronous-metrics'
import { backupsConfig } from '@/lib/query-config/more/backups'
import { dictionariesConfig } from '@/lib/query-config/more/dictionaries'
import { errorsConfig } from '@/lib/query-config/more/errors'
import { mergeTreeSettingsConfig } from '@/lib/query-config/more/mergetree-settings'
import { metricsConfig } from '@/lib/query-config/more/metrics'
import { rolesConfig } from '@/lib/query-config/more/roles'
import { settingsConfig } from '@/lib/query-config/more/settings'
import { topUsageColumnsConfig } from '@/lib/query-config/more/top-usage-columns'
import { topUsageTablesConfig } from '@/lib/query-config/more/top-usage-tables'
import { unusedColumnsConfig } from '@/lib/query-config/more/unused-columns'
import { unusedProjectionsConfig } from '@/lib/query-config/more/unused-projections'
import { unusedTablesConfig } from '@/lib/query-config/more/unused-tables'
import { usersConfig } from '@/lib/query-config/more/users'
import { zookeeperConfig } from '@/lib/query-config/more/zookeeper'

// ---------------------------------------------------------------------------
// Helper: compare serializable fields between loaded declarative config and
// legacy TS config. Skips keys absent from the declarative schema.
// ---------------------------------------------------------------------------

const RUNTIME_ONLY_KEYS = new Set([
  'rowClassName',
  'expandable',
  'columnIcons',
  'filterSchema',
  'columnFilters',
  'clickhouseSettings',
  'variants',
])

function compareSerializable(
  loaded: ReturnType<typeof loadDeclarativeConfig>,
  legacy: ReturnType<typeof loadDeclarativeConfig>
): void {
  const legacyRec = legacy as unknown as Record<string, unknown>
  const loadedRec = loaded as unknown as Record<string, unknown>

  for (const key of Object.keys(legacyRec)) {
    if (RUNTIME_ONLY_KEYS.has(key)) continue
    expect(loadedRec[key]).toEqual(legacyRec[key])
  }
}

// ---------------------------------------------------------------------------
// Helper: a compiled `expandable` is a function, so it can't be deep-equalled.
// createConfigExpandedDetails returns (row) => <ConfigExpandedDetails .../>, so
// we inspect the React element it produces WITHOUT rendering: the same factory
// yields the same element .type (component reference identity) and the same
// `primaryColumns` prop. That proves the loader bound the same panel + columns.
// ---------------------------------------------------------------------------

function expectExpandableMatchesLegacy(
  loaded: ReturnType<typeof loadDeclarativeConfig>,
  legacyExpandable: ExpandableConfig
): void {
  expect(loaded.expandable).toBeDefined()
  const loadedRenderer = (loaded.expandable as ExpandableConfig).renderExpanded
  const sampleRow = { name: 'sample', extra_column: 'value' }
  const ctx = { row: {} } as unknown as Parameters<typeof loadedRenderer>[1]

  const loadedEl = loadedRenderer(sampleRow, ctx) as unknown as {
    type: unknown
    props: Record<string, unknown>
  }
  const legacyEl = legacyExpandable.renderExpanded(
    sampleRow,
    ctx
  ) as unknown as {
    type: unknown
    props: Record<string, unknown>
  }

  expect(loadedEl.type).toBe(legacyEl.type)
  expect(loadedEl.props.primaryColumns).toEqual(legacyEl.props.primaryColumns)
}

// ---------------------------------------------------------------------------
// asynchronous-metrics
// ---------------------------------------------------------------------------

describe('asynchronous-metrics declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeConfig(asynchronousMetricsDeclarative)
    ).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(asynchronousMetricsDeclarative)
    compareSerializable(loaded, asynchronousMetricsConfig)
  })
})

// ---------------------------------------------------------------------------
// backups
// ---------------------------------------------------------------------------

describe('backups declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(backupsDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(backupsDeclarative)
    compareSerializable(loaded, backupsConfig)
  })
})

// ---------------------------------------------------------------------------
// dictionaries
// ---------------------------------------------------------------------------

describe('dictionaries declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(dictionariesDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(dictionariesDeclarative)
    compareSerializable(loaded, dictionariesConfig)
  })
})

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

describe('errors declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(errorsDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(errorsDeclarative)
    compareSerializable(loaded, errorsConfig)
  })
})

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------

describe('roles declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(rolesDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(rolesDeclarative)
    compareSerializable(loaded, rolesConfig)
  })
})

// ---------------------------------------------------------------------------
// top-usage-columns
// ---------------------------------------------------------------------------

describe('top-usage-columns declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeConfig(topUsageColumnsDeclarative)
    ).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(topUsageColumnsDeclarative)
    compareSerializable(loaded, topUsageColumnsConfig)
  })

  test('versioned sql array length matches', () => {
    const loaded = loadDeclarativeConfig(topUsageColumnsDeclarative)
    const legacySql = topUsageColumnsConfig.sql
    expect(Array.isArray(loaded.sql)).toBe(Array.isArray(legacySql))
    if (Array.isArray(loaded.sql) && Array.isArray(legacySql)) {
      expect(loaded.sql.length).toBe(legacySql.length)
    }
  })
})

// ---------------------------------------------------------------------------
// top-usage-tables
// ---------------------------------------------------------------------------

describe('top-usage-tables declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(topUsageTablesDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(topUsageTablesDeclarative)
    compareSerializable(loaded, topUsageTablesConfig)
  })

  test('versioned sql array length matches', () => {
    const loaded = loadDeclarativeConfig(topUsageTablesDeclarative)
    const legacySql = topUsageTablesConfig.sql
    expect(Array.isArray(loaded.sql)).toBe(Array.isArray(legacySql))
    if (Array.isArray(loaded.sql) && Array.isArray(legacySql)) {
      expect(loaded.sql.length).toBe(legacySql.length)
    }
  })
})

// ---------------------------------------------------------------------------
// unused-columns / unused-projections
// ---------------------------------------------------------------------------

describe('unused-columns declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(unusedColumnsDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(unusedColumnsDeclarative)
    compareSerializable(loaded, unusedColumnsConfig)
  })
})

describe('unused-projections declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeConfig(unusedProjectionsDeclarative)
    ).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(unusedProjectionsDeclarative)
    compareSerializable(loaded, unusedProjectionsConfig)
  })
})

// ---------------------------------------------------------------------------
// unused-tables
// ---------------------------------------------------------------------------

describe('unused-tables declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(unusedTablesDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(unusedTablesDeclarative)
    compareSerializable(loaded, unusedTablesConfig)
  })
})

// ---------------------------------------------------------------------------
// zookeeper
// ---------------------------------------------------------------------------

describe('zookeeper declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(zookeeperDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(zookeeperDeclarative)
    compareSerializable(loaded, zookeeperConfig)
  })
})

// ---------------------------------------------------------------------------
// mergetree-settings — permission migrated to declarative `permission`
// ---------------------------------------------------------------------------

describe('mergetree-settings declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeConfig(mergeTreeSettingsDeclarative)
    ).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(mergeTreeSettingsDeclarative)
    compareSerializable(loaded, mergeTreeSettingsConfig)
  })

  test('permission matches legacy', () => {
    const loaded = loadDeclarativeConfig(mergeTreeSettingsDeclarative)
    expect(loaded.permission).toEqual(mergeTreeSettingsConfig.permission)
  })
})

// ---------------------------------------------------------------------------
// metrics — permission migrated to declarative `permission`
// ---------------------------------------------------------------------------

describe('metrics declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(metricsDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(metricsDeclarative)
    compareSerializable(loaded, metricsConfig)
  })

  test('permission matches legacy', () => {
    const loaded = loadDeclarativeConfig(metricsDeclarative)
    expect(loaded.permission).toEqual(metricsConfig.permission)
  })
})

// ---------------------------------------------------------------------------
// settings — expandable (config-details) + permission migrated to declarative
// ---------------------------------------------------------------------------

describe('settings declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(settingsDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(settingsDeclarative)
    compareSerializable(loaded, settingsConfig)
  })

  test('permission matches legacy', () => {
    const loaded = loadDeclarativeConfig(settingsDeclarative)
    expect(loaded.permission).toEqual(settingsConfig.permission)
  })

  test('expandable binds the same factory + primaryColumns as legacy', () => {
    const loaded = loadDeclarativeConfig(settingsDeclarative)
    expectExpandableMatchesLegacy(
      loaded,
      settingsConfig.expandable as ExpandableConfig
    )
  })
})

// ---------------------------------------------------------------------------
// users — expandable (config-details) migrated to declarative
// ---------------------------------------------------------------------------

describe('users declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeConfig(usersDeclarative)).not.toThrow()
  })

  test('serializable fields match legacy', () => {
    const loaded = loadDeclarativeConfig(usersDeclarative)
    compareSerializable(loaded, usersConfig)
  })

  test('expandable binds the same factory + primaryColumns as legacy', () => {
    const loaded = loadDeclarativeConfig(usersDeclarative)
    expectExpandableMatchesLegacy(
      loaded,
      usersConfig.expandable as ExpandableConfig
    )
  })
})
