// Test fixtures shared across the advisor test suite — not a `.test.ts` file
// itself (mirrors `agent/tools/__tests__/shared-mocks.ts`), so bun test never
// tries to run it directly.
import type {
  ColumnStat,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  QueryContext,
  TableSchema,
} from '../recommendation-engine'

export function makeColumn(overrides: Partial<ColumnStat> = {}): ColumnStat {
  return {
    name: 'user_id',
    type: 'UInt64',
    isInPartitionKey: false,
    isInSortingKey: false,
    compressedBytes: 1_000_000,
    uncompressedBytes: 2_000_000,
    ...overrides,
  }
}

export function makeSkipIndex(
  overrides: Partial<ExistingSkipIndex> = {}
): ExistingSkipIndex {
  return {
    name: 'idx_existing',
    type: 'minmax',
    expression: 'some_other_column',
    granularity: 4,
    ...overrides,
  }
}

export function makeSchema(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    database: 'default',
    table: 'events',
    partitionKeyColumns: ['event_date'],
    sortingKeyColumns: ['event_date', 'user_id'],
    columns: [
      makeColumn({
        name: 'event_date',
        type: 'Date',
        isInPartitionKey: true,
        isInSortingKey: true,
        compressedBytes: 500_000,
      }),
      makeColumn({
        name: 'user_id',
        type: 'UInt64',
        isInSortingKey: true,
        compressedBytes: 1_000_000,
      }),
      makeColumn({
        name: 'status',
        type: 'String',
        compressedBytes: 2_000_000,
      }),
      makeColumn({
        name: 'payload',
        type: 'String',
        compressedBytes: 50_000_000,
      }),
    ],
    existingSkipIndexes: [],
    ...overrides,
  }
}

export function makeParts(overrides: Partial<PartsStats> = {}): PartsStats {
  return {
    activeParts: 20,
    totalRows: 10_000_000,
    totalBytes: 100_000_000,
    totalGranules: 10_000,
    ...overrides,
  }
}

/**
 * Realistic-shape `EXPLAIN PLAN indexes=1` text — mirrors ClickHouse's actual
 * output structure (nested nesting nested under `ReadFromMergeTree`).
 * `parseExplainIndexes` is a line-scanner and doesn't care about the leading
 * whitespace, only the section keywords, so this fixture also validates the
 * parser tolerates real indentation.
 */
export const EXPLAIN_INDEXES_LOW_PRUNING = [
  'Expression ((Projection + Before ORDER BY))',
  '  Filter (WHERE)',
  '    ReadFromMergeTree (default.events)',
  '    Indexes:',
  '      PrimaryKey',
  '        Keys:',
  '          event_date',
  '        Condition: true (unknown)',
  '        Parts: 20/20',
  '        Granules: 9000/10000',
]

export const EXPLAIN_INDEXES_WITH_SKIP = [
  'Expression',
  '  ReadFromMergeTree (default.events)',
  '  Indexes:',
  '    PrimaryKey',
  '      Parts: 20/20',
  '      Granules: 9000/10000',
  '    Skip',
  '      Name: idx_status',
  '      Description: minmax GRANULARITY 4',
  '      Parts: 5/20',
  '      Granules: 100/9000',
]

export function makeExplain(
  overrides: Partial<ExplainIndexesInfo> = {}
): ExplainIndexesInfo {
  return {
    primaryKey: {
      partsRead: 20,
      partsTotal: 20,
      granulesRead: 9000,
      granulesTotal: 10000,
    },
    skipIndexes: [],
    ...overrides,
  }
}

export function makeContext(
  overrides: Partial<QueryContext> = {}
): QueryContext {
  return {
    sql: "SELECT * FROM default.events WHERE status = 'error' LIMIT 100",
    database: 'default',
    table: 'events',
    predicates: [
      { column: 'status', operator: '=', isRange: false, isEqualityOrIn: true },
    ],
    groupByColumns: [],
    orderByColumns: [],
    hasPrewhere: false,
    schema: makeSchema(),
    parts: makeParts(),
    explain: makeExplain(),
    ...overrides,
  }
}
