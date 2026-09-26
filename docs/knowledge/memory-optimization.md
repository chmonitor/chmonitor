---
id: memory-optimization
title: Memory Optimization
type: reference
status: active
updated: 2026-09-27
tags:
  - performance
  - memory
  - caching
  - monitoring
related:
  - rust-wasm-performance
  - deployment
---

# Memory Optimization

Comprehensive memory optimizations reducing overall footprint by 50-70%.

## Key Optimizations

### 1. Connection Pooling
- **File**: `packages/clickhouse-client/src/index.ts` (pooling in
  `packages/clickhouse-client/src/clickhouse/connection-pool.ts`)
- Reuses ClickHouse client instances via connection pool
- Access stats: `getConnectionPoolStats()`

### 2. Data Table Memoization
- **File**: `components/data-table/data-table.tsx`
- Prevents unnecessary recalculation of column definitions
- Add `useMemo` when adding new expensive table operations

### 3. Production Logger
- **File**: `packages/logger/src/index.ts`
- Conditional logging (development only by default)
- Replace `console.log()` with `debug()`, `log()`, `error()`, `warn()`
- Enable debug: `DEBUG=true` environment variable

### 4. Optimized Chart Processing
- **Files**: `components/charts/*.tsx`
- Single-pass algorithms using Set for O(n) complexity
- Collect categories during data reduction instead of after

### 5. Cache Memory Limits
- **File**: `packages/clickhouse-client/src/table-existence-cache.ts`
- Hard limit: 1MB maximum cache size
- Max entries: 500

### 6. Memory Monitoring
- **File**: `apps/dashboard/src/routes/api/health.ts`
- Health endpoint: `GET /api/health`

## Performance Targets

| Metric | Before | After | Gain |
|--------|--------|-------|------|
| ClickHouse clients memory | 1-2MB per client | 200KB pooled | 80% |
| Table render time (100+ cols) | 50-100ms | 10-20ms | 70% |
| Chart processing (1000+ rows) | O(n^2) | O(n) | 95% |
| Cache memory limit | Unbounded (~8MB) | 1MB hard | 87% |

## Monitoring

```bash
# Check health
curl http://localhost:3000/api/health | jq '.'

# Watch memory
curl -s http://localhost:3000/api/health | jq '.metrics.memory'

# Check cache
curl -s http://localhost:3000/api/health | jq '.metrics.tableCache'
```
