// @ts-nocheck — test file, only runs under bun:test

import type { ClusterContext, TableProfile } from '../types'

import {
  dateColumnFromPartitionKey,
  firstSortingIdent,
  isMergeTreeFamily,
  isReplicatedOrShared,
  ruleMissingDistributed,
  ruleMissingTtl,
  ruleNonReplicatedOnCluster,
  rulePartitionCount,
  ruleUuidLeadingSortKey,
  runTableRules,
  ttlFromEngineFull,
} from '../table-rules'
import { describe, expect, test } from 'bun:test'

function makeTable(overrides: Partial<TableProfile> = {}): TableProfile {
  return {
    database: 'db',
    table: 'events',
    engine: 'MergeTree',
    engineFull: 'MergeTree PARTITION BY toYYYYMMDD(event_time) ORDER BY id',
    sortingKey: 'id',
    partitionKey: 'toYYYYMMDD(event_time)',
    primaryKey: 'id',
    ttlExpression: '',
    partitions: 12,
    activeParts: 12,
    bytesOnDisk: 50_000_000,
    rows: 1_000_000,
    leadingSortType: 'UInt64',
    ...overrides,
  }
}

function cluster(
  overrides: Partial<NonNullable<ClusterContext>> = {}
): NonNullable<ClusterContext> {
  return {
    cluster: 'prod',
    replicaCount: 3,
    distributedTargets: new Set(),
    existingTables: new Set(['db.events']),
    ...overrides,
  }
}

describe('ttlFromEngineFull / dateColumnFromPartitionKey / firstSortingIdent', () => {
  test('extracts TTL before SETTINGS', () => {
    expect(
      ttlFromEngineFull(
        'MergeTree PARTITION BY toYYYYMM(d) ORDER BY id TTL d + INTERVAL 30 DAY SETTINGS index_granularity = 8192'
      )
    ).toBe('d + INTERVAL 30 DAY')
  })
  test('empty when there is no TTL clause', () => {
    expect(ttlFromEngineFull('MergeTree ORDER BY id')).toBe('')
  })
  test('pulls the date column out of time-based partition helpers', () => {
    expect(dateColumnFromPartitionKey('toYYYYMMDD(event_time)')).toBe(
      'event_time'
    )
    expect(dateColumnFromPartitionKey('toStartOfMonth(ts)')).toBe('ts')
    expect(dateColumnFromPartitionKey('city_id')).toBe(null)
  })
  test('firstSortingIdent skips expressions', () => {
    expect(firstSortingIdent('tenant_id, event_date, id')).toBe('tenant_id')
    expect(firstSortingIdent('sipHash64(id)')).toBe(null)
  })
  test('engine helpers', () => {
    expect(isMergeTreeFamily('ReplacingMergeTree')).toBe(true)
    expect(isReplicatedOrShared('ReplicatedMergeTree')).toBe(true)
    expect(isReplicatedOrShared('SharedMergeTree')).toBe(true)
    expect(isReplicatedOrShared('MergeTree')).toBe(false)
  })
})

describe('ruleMissingTtl', () => {
  test('emits ALTER MODIFY TTL when the partition key has a date column', () => {
    const findings = ruleMissingTtl([makeTable()])
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('missing_ttl')
    expect(findings[0].ddl).toContain(
      'MODIFY TTL `event_time` + INTERVAL 90 DAY'
    )
    expect(findings[0].estimatedBytesSaved).toBeGreaterThan(0)
  })
  test('skips tables that already have TTL', () => {
    expect(
      ruleMissingTtl([
        makeTable({ ttlExpression: 'event_time + INTERVAL 30 DAY' }),
      ])
    ).toEqual([])
  })
  test('skips Distributed wrappers', () => {
    expect(ruleMissingTtl([makeTable({ engine: 'Distributed' })])).toEqual([])
  })
})

describe('rulePartitionCount', () => {
  test('500+ partitions is high_partition_count', () => {
    const findings = rulePartitionCount([makeTable({ partitions: 500 })])
    expect(findings[0].ruleId).toBe('high_partition_count')
    expect(findings[0].ddl).toContain('PARTITION BY toYYYYMM(event_time)')
    expect(findings[0].severity).toBe('medium')
  })
  test('1000+ partitions is too_many_partitions', () => {
    const findings = rulePartitionCount([makeTable({ partitions: 1000 })])
    expect(findings[0].ruleId).toBe('too_many_partitions')
    expect(findings[0].severity).toBe('high')
  })
  test('healthy partition counts are silent', () => {
    expect(rulePartitionCount([makeTable({ partitions: 12 })])).toEqual([])
  })
})

describe('ruleNonReplicatedOnCluster', () => {
  test('flags MergeTree when the cluster has 2+ replicas', () => {
    const findings = ruleNonReplicatedOnCluster([makeTable()], cluster())
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('non_replicated_on_cluster')
    expect(findings[0].ddl).toContain('ON CLUSTER')
    expect(findings[0].ddl).toContain('ReplicatedMergeTree')
  })
  test('skips Replicated and Shared engines', () => {
    expect(
      ruleNonReplicatedOnCluster(
        [makeTable({ engine: 'ReplicatedMergeTree' })],
        cluster()
      )
    ).toEqual([])
    expect(
      ruleNonReplicatedOnCluster(
        [makeTable({ engine: 'SharedMergeTree' })],
        cluster()
      )
    ).toEqual([])
  })
  test('skips single-replica clusters', () => {
    expect(
      ruleNonReplicatedOnCluster([makeTable()], cluster({ replicaCount: 1 }))
    ).toEqual([])
    expect(ruleNonReplicatedOnCluster([makeTable()], null)).toEqual([])
  })
})

describe('ruleMissingDistributed', () => {
  test('suggests CREATE Distributed when no wrapper exists', () => {
    const findings = ruleMissingDistributed(
      [makeTable({ engine: 'ReplicatedMergeTree' })],
      cluster()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('missing_distributed')
    expect(findings[0].ddl).toContain('CREATE TABLE')
    expect(findings[0].ddl).toContain('ENGINE = Distributed')
    expect(findings[0].ddl).toContain('events_dist')
    expect(findings[0].ddl).toContain('rand()')
  })
  test('uses the unsuffixed name when the local table is *_local', () => {
    const findings = ruleMissingDistributed(
      [makeTable({ table: 'events_local', engine: 'ReplicatedMergeTree' })],
      cluster({ existingTables: new Set(['db.events_local']) })
    )
    expect(findings[0].ddl).toContain('`events`')
    expect(findings[0].ddl).not.toContain('events_dist')
  })
  test('skips when a Distributed table already points at it', () => {
    expect(
      ruleMissingDistributed(
        [makeTable({ engine: 'ReplicatedMergeTree' })],
        cluster({ distributedTargets: new Set(['db.events']) })
      )
    ).toEqual([])
  })
  test('skips SharedMergeTree (cloud queries the table directly)', () => {
    expect(
      ruleMissingDistributed(
        [makeTable({ engine: 'SharedMergeTree' })],
        cluster()
      )
    ).toEqual([])
  })
})

describe('ruleUuidLeadingSortKey', () => {
  test('flags a leading UUID ORDER BY column', () => {
    const findings = ruleUuidLeadingSortKey([
      makeTable({
        sortingKey: 'user_id, event_date',
        leadingSortType: 'UUID',
      }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('uuid_leading_sort_key')
    expect(findings[0].ddl).toContain('Rebuild required')
  })
  test('flags Nullable(UUID)', () => {
    expect(
      ruleUuidLeadingSortKey([
        makeTable({ sortingKey: 'id', leadingSortType: 'Nullable(UUID)' }),
      ])
    ).toHaveLength(1)
  })
  test('skips non-UUID leading types and expressions', () => {
    expect(
      ruleUuidLeadingSortKey([makeTable({ leadingSortType: 'UInt64' })])
    ).toEqual([])
    expect(
      ruleUuidLeadingSortKey([
        makeTable({ sortingKey: 'sipHash64(id)', leadingSortType: 'UUID' }),
      ])
    ).toEqual([])
  })
})

describe('runTableRules', () => {
  test('aggregates table-level findings and stays recommend-only', () => {
    const findings = runTableRules(
      [
        makeTable({
          partitions: 1200,
          leadingSortType: 'UUID',
          sortingKey: 'id',
        }),
      ],
      cluster()
    )
    const ids = new Set(findings.map((f) => f.ruleId))
    expect(ids.has('missing_ttl')).toBe(true)
    expect(ids.has('too_many_partitions')).toBe(true)
    expect(ids.has('non_replicated_on_cluster')).toBe(true)
    expect(ids.has('missing_distributed')).toBe(true)
    expect(ids.has('uuid_leading_sort_key')).toBe(true)
    expect(
      findings.every((f) => typeof f.ddl === 'string' && f.ddl.length > 0)
    ).toBe(true)
    expect(findings.some((f) => /DROP TABLE/i.test(f.ddl))).toBe(false)
  })
})
