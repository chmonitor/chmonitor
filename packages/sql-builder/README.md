# SQL Builder

Type-safe, fluent API for building ClickHouse SQL queries.

## Features

- **Immutable builders**: All methods return new instances for safe chaining
- **ClickHouse-specific helpers**: Format functions, profile events, window functions
- **Type-safe**: Full TypeScript support with JSDoc comments
- **Composable**: Mix and match builders for complex queries
- **Escape hatches**: Raw SQL when you need it

## Installation

```typescript
import { col, fn, raw, param } from '@/lib/sql-builder'
```

## Column Builder

Build column expressions with automatic formatting and aliasing.

### Basic Usage

```typescript
col('user_id')                    // → "user_id"
col('user_id').as('uid')          // → "user_id AS uid"
```

### ClickHouse Formatting

Auto-generates readable aliases:

```typescript
col('bytes').readable()           // → "formatReadableSize(bytes) AS readable_bytes"
col('rows').quantity()            // → "formatReadableQuantity(rows) AS readable_rows"
col('elapsed').timeDelta()        // → "formatReadableTimeDelta(elapsed) AS readable_elapsed"
```

Custom aliases:

```typescript
col('bytes').as('size').readable()
// → "formatReadableSize(bytes) AS size"
```

### Percentage of Max

Calculate percentage of maximum value using window functions:

```typescript
col('elapsed').pctOfMax()         // → "round(100 * elapsed / max(elapsed) OVER (), 2) AS pct_elapsed"
col('bytes').pctOfMax(1)          // → "round(100 * bytes / max(bytes) OVER (), 1) AS pct_bytes"
```

### Window Functions

```typescript
// Simple window
col('elapsed').over({})
// → "elapsed OVER ()"

// Partition by single column
col('elapsed').over({ partitionBy: 'user' })
// → "elapsed OVER (PARTITION BY user)"

// Partition by multiple columns
col('elapsed').over({ partitionBy: ['user', 'query_id'] })
// → "elapsed OVER (PARTITION BY user, query_id)"

// Order by
col('elapsed').over({ orderBy: 'event_time DESC' })
// → "elapsed OVER (ORDER BY event_time DESC)"

// Combine partition and order
col('elapsed').over({
  partitionBy: 'user',
  orderBy: 'event_time DESC'
}).as('elapsed_rank')
// → "elapsed OVER (PARTITION BY user ORDER BY event_time DESC) AS elapsed_rank"
```

### Static Helpers

```typescript
// Concatenate strings
col.concat('database', '.', 'table').as('full_name')
// → "concat('database', '.', 'table') AS full_name"

// Aggregates
col.sum('bytes').as('total_bytes')      // → "sum(bytes) AS total_bytes"
col.count().as('total')                 // → "count() AS total"
col.count('user_id').as('user_count')   // → "count(user_id) AS user_count"
col.avg('duration').as('avg_duration')  // → "avg(duration) AS avg_duration"
col.max('bytes').as('max_bytes')        // → "max(bytes) AS max_bytes"
col.min('bytes').as('min_bytes')        // → "min(bytes) AS min_bytes"
```

## Function Helpers

Direct SQL function calls without column builder.

### Formatting Functions

```typescript
fn.readableSize('bytes')          // → "formatReadableSize(bytes)"
fn.readableQuantity('rows')       // → "formatReadableQuantity(rows)"
fn.readableTimeDelta('elapsed')   // → "formatReadableTimeDelta(elapsed)"
```

### Aggregates

```typescript
fn.sum('bytes')                   // → "sum(bytes)"
fn.count()                        // → "count()"
fn.count('user_id')               // → "count(user_id)"
fn.avg('duration')                // → "avg(duration)"
fn.max('bytes')                   // → "max(bytes)"
fn.min('bytes')                   // → "min(bytes)"
```

### Window Functions

```typescript
fn.pctOfMax('elapsed')            // → "round(100 * elapsed / max(elapsed) OVER (), 2)"
fn.pctOfMax('bytes', 1)           // → "round(100 * bytes / max(bytes) OVER (), 1)"
```

### ClickHouse Specific

```typescript
fn.profileEvent('MemoryUsage')    // → "ProfileEvents['MemoryUsage']"
fn.profileEvent('Query')          // → "ProfileEvents['Query']"
```

### Date/Time

```typescript
fn.toDate('event_time')           // → "toDate(event_time)"
fn.toDateTime('event_time')       // → "toDateTime(event_time)"
fn.today()                        // → "today()"
fn.now()                          // → "now()"
```

## Raw SQL

Escape hatch for arbitrary SQL expressions.

```typescript
raw('x + y')                      // → "x + y"
raw('x + y').as('sum')            // → "(x + y) AS sum"

raw('CASE WHEN x > 0 THEN 1 ELSE 0 END').as('flag')
// → "(CASE WHEN x > 0 THEN 1 ELSE 0 END) AS flag"
```

## Parameters

ClickHouse query parameter placeholders.

```typescript
param('user', 'String')           // → "{user:String}"
param('limit', 'UInt32')          // → "{limit:UInt32}"
param('start_date', 'DateTime')   // → "{start_date:DateTime}"
```

## Real-World Examples

### Query Monitoring

```typescript
const columns = [
  col('query_id'),
  col('user'),
  col('query_duration_ms').as('duration'),
  col('read_bytes').readable(),
  col('memory_usage').readable(),
  col('query_duration_ms').pctOfMax().as('pct_duration'),
]

const sql = `
SELECT
  ${columns.map(c => c.toSql()).join(',\n  ')}
FROM system.query_log
WHERE event_time >= ${param('start_time', 'DateTime')}
  AND user = ${param('user', 'String')}
ORDER BY query_duration_ms DESC
LIMIT ${param('limit', 'UInt32')}
`
```

Output:
```sql
SELECT
  query_id,
  user,
  query_duration_ms AS duration,
  formatReadableSize(read_bytes) AS readable_read_bytes,
  formatReadableSize(memory_usage) AS readable_memory_usage,
  round(100 * query_duration_ms / max(query_duration_ms) OVER (), 2) AS pct_duration
FROM system.query_log
WHERE event_time >= {start_time:DateTime}
  AND user = {user:String}
ORDER BY query_duration_ms DESC
LIMIT {limit:UInt32}
```

### Aggregation Query

```typescript
const columns = [
  col('user'),
  col.count('query_id').as('query_count'),
  col.sum('read_bytes').as('total_bytes'),
  col.avg('query_duration_ms').as('avg_duration'),
  col.max('memory_usage').as('peak_memory'),
]

const sql = `
SELECT
  ${columns.map(c => c.toSql()).join(',\n  ')}
FROM system.query_log
WHERE event_date = ${fn.today()}
GROUP BY user
ORDER BY query_count DESC
`
```

Output:
```sql
SELECT
  user,
  count(query_id) AS query_count,
  sum(read_bytes) AS total_bytes,
  avg(query_duration_ms) AS avg_duration,
  max(memory_usage) AS peak_memory
FROM system.query_log
WHERE event_date = today()
GROUP BY user
ORDER BY query_count DESC
```

### Profile Events

```typescript
const columns = [
  col('event_time'),
  raw(fn.profileEvent('Query')).as('queries'),
  raw(fn.profileEvent('SelectQuery')).as('select_queries'),
  raw(fn.profileEvent('InsertQuery')).as('insert_queries'),
  raw(fn.profileEvent('MemoryUsage')).as('memory_usage'),
]

const sql = `
SELECT
  ${columns.map(c => c.toSql()).join(',\n  ')}
FROM system.metric_log
WHERE event_time >= ${fn.now()} - INTERVAL 1 HOUR
ORDER BY event_time DESC
`
```

Output:
```sql
SELECT
  event_time,
  (ProfileEvents['Query']) AS queries,
  (ProfileEvents['SelectQuery']) AS select_queries,
  (ProfileEvents['InsertQuery']) AS insert_queries,
  (ProfileEvents['MemoryUsage']) AS memory_usage
FROM system.metric_log
WHERE event_time >= now() - INTERVAL 1 HOUR
ORDER BY event_time DESC
```

### Window Functions with Rankings

```typescript
const columns = [
  col('user'),
  col('query_id'),
  col('query_duration_ms'),
  col('query_duration_ms').over({
    partitionBy: 'user',
    orderBy: 'query_duration_ms DESC'
  }).as('duration_rank'),
  col('query_duration_ms').pctOfMax().as('pct_of_max'),
]

const sql = `
SELECT
  ${columns.map(c => c.toSql()).join(',\n  ')}
FROM system.query_log
WHERE event_date = ${fn.today()}
`
```

Output:
```sql
SELECT
  user,
  query_id,
  query_duration_ms,
  query_duration_ms OVER (PARTITION BY user ORDER BY query_duration_ms DESC) AS duration_rank,
  round(100 * query_duration_ms / max(query_duration_ms) OVER (), 2) AS pct_of_max
FROM system.query_log
WHERE event_date = today()
```

## Design Principles

### Immutability

All builders return new instances:

```typescript
const original = col('test')
const aliased = original.as('alias')

original.toSql()  // → "test"
aliased.toSql()   // → "test AS alias"
```

### Composability

Mix and match builders:

```typescript
const columns = [
  col('id'),                          // Plain column
  col('bytes').readable(),            // ClickHouse formatting
  raw('x + y').as('calculated'),      // Raw SQL
  col.sum('rows').as('total'),        // Aggregate
]
```

### Type Safety

Full TypeScript support with JSDoc:

```typescript
col('bytes')
  .readable()     // ✓ Valid
  .as('size')     // ✓ Valid
  .toSql()        // ✓ Returns string

col('bytes').readable().invalid()  // ✗ TypeScript error
```

## API Reference

### ColumnBuilder

- `as(alias: string): ColumnBuilder` - Set alias
- `readable(): ColumnBuilder` - Format as readable size
- `quantity(): ColumnBuilder` - Format as readable quantity
- `timeDelta(): ColumnBuilder` - Format as readable time delta
- `pctOfMax(precision?: number): ColumnBuilder` - Percentage of max
- `over(opts: WindowOptions): ColumnBuilder` - Window function
- `toSql(): string` - Convert to SQL

### col Static Methods

- `col.concat(...parts: string[]): ColumnBuilder`
- `col.sum(column: string): ColumnBuilder`
- `col.count(column?: string): ColumnBuilder`
- `col.avg(column: string): ColumnBuilder`
- `col.max(column: string): ColumnBuilder`
- `col.min(column: string): ColumnBuilder`

### fn Namespace

- `fn.readableSize(column: string): string`
- `fn.readableQuantity(column: string): string`
- `fn.readableTimeDelta(column: string): string`
- `fn.sum(column: string): string`
- `fn.count(column?: string): string`
- `fn.avg(column: string): string`
- `fn.max(column: string): string`
- `fn.min(column: string): string`
- `fn.pctOfMax(column: string, precision?: number): string`
- `fn.profileEvent(name: string): string`
- `fn.toDate(column: string): string`
- `fn.toDateTime(column: string): string`
- `fn.today(): string`
- `fn.now(): string`

### RawSql

- `as(alias: string): RawSql` - Set alias
- `toSql(): string` - Convert to SQL

### param

- `param(name: string, type: string): string` - Create parameter placeholder

## Testing

Run tests:

```bash
pnpm run jest lib/sql-builder/__tests__/
```

Coverage:
- 67 tests, 100% statement coverage
- Tests for all builders, functions, and integration scenarios
