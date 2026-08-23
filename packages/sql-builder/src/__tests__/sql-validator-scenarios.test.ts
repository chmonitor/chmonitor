/**
 * SQL Validator — realistic scenario battery
 *
 * Breadth coverage for {@link validateSqlQuery}: a large, diverse corpus of
 * realistic read-only ClickHouse queries that MUST be accepted, plus genuinely
 * dangerous queries that MUST be rejected. Complements the focused unit tests
 * in `sql-validator.test.ts` and the shipped-query corpus test in the dashboard
 * (`shipped-sql-passes-validator.test.ts`).
 *
 * The generated matrix deliberately exercises functions and predicates that sit
 * NEAR the remaining denylist tokens (url-family/path/protocol vs `url(` and
 * `file(`, `granted`/`access_type` vs GRANT/REVOKE, `is_currently_executing`
 * vs EXECUTE, `system.detached_parts` vs DETACH, all replace-family variants)
 * so a future
 * denylist tweak that reintroduces a false-positive collision fails here.
 *
 * See docs/knowledge/sql-validator-threat-model.md for the rationale.
 */

import { validateSqlQuery } from '../sql-validator'
import { describe, expect, test } from 'bun:test'

function isAccepted(sql: string): boolean {
  try {
    validateSqlQuery(sql)
    return true
  } catch {
    return false
  }
}

/** Assert every query in `list` yields `expected`, reporting all mismatches. */
function assertVerdicts(list: string[], expected: 'accept' | 'reject'): void {
  const mismatches: string[] = []
  for (const sql of list) {
    const got = isAccepted(sql) ? 'accept' : 'reject'
    if (got !== expected) {
      mismatches.push(
        `  expected ${expected}, got ${got}: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`
      )
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `${mismatches.length}/${list.length} query verdict(s) wrong:\n${mismatches.join('\n')}`
    )
  }
  expect(mismatches).toHaveLength(0)
}

// Functions chosen to include many that sit near denylist tokens.
const FUNCTIONS = [
  'count',
  'sum',
  'avg',
  'max',
  'min',
  'any',
  'anyLast',
  'uniqExact',
  'uniqCombined',
  'quantile(0.5)',
  'quantile(0.99)',
  'quantilesTDigest(0.5)(x)',
  'median(query_duration_ms)',
  'stddevPop(x)',
  'varSamp(x)',
  'topK(5)(name)',
  'groupArray(name)',
  'groupUniqArray(name)',
  'argMax(query, event_time)',
  'argMin(query, event_time)',
  'countIf(read_rows > 0)',
  'sumIf(x, x > 0)',
  'formatReadableSize(bytes)',
  'formatReadableQuantity(rows)',
  'formatReadableTimeDelta(s)',
  'toStartOfHour(event_time)',
  'toStartOfFiveMinutes(event_time)',
  'toUnixTimestamp(event_time)',
  'toDate(event_time)',
  'toDateTime(event_time)',
  'toString(x)',
  "replace(query, 'a', 'b')",
  "replaceAll(query, 'a', 'b')",
  "replaceOne(query, 'a', 'b')",
  "replaceRegexpAll(query, '\\\\d+', '?')",
  "replaceRegexpOne(query, '\\\\d+', '?')",
  "extractURLParameter(http_referer, 'q')",
  'extractURLParameters(http_referer)',
  'domain(http_referer)',
  'domainWithoutWWW(http_referer)',
  'topLevelDomain(http_referer)',
  'path(http_referer)',
  'pathFull(http_referer)',
  'protocol(http_referer)',
  'queryString(http_referer)',
  'fragment(http_referer)',
  'cutToFirstSignificantSubdomain(http_referer)',
  'netloc(http_referer)',
  "splitByChar(',', query)",
  'substring(query, 1, 80)',
  'substr(query, 1, 80)',
  'lower(query)',
  'upper(query)',
  'length(query)',
  'reverse(query)',
  'trimBoth(query)',
  "concat(database, '.', name)",
  'lengthUTF8(query)',
  "if(type = 'A', 1, 0)",
  "multiIf(x = 1, 'a', 'b')",
  'arrayJoin(thread_ids)',
  'arraySum(x)',
  'arrayMap(v -> v * 2, x)',
  'bitAnd(a, b)',
  'bitShiftLeft(a, 1)',
  'modulo(a, b)',
  'intDiv(a, b)',
  'greatest(a, b)',
  'least(a, b)',
]

const TABLES = [
  'system.query_log',
  'system.parts',
  'system.tables',
  'system.columns',
  'system.merges',
  'system.mutations',
  'system.replicas',
  'system.processes',
  'system.detached_parts',
  'system.replication_queue',
  'system.grants',
  'system.settings',
  'system.metrics',
  'system.asynchronous_metrics',
  'system.disks',
  'system.databases',
  'system.dictionaries',
  'system.parts_columns',
  'system.role_grants',
  'system.row_policies',
  'system.quotas',
  'system.users',
  'system.zookeeper',
  'system.errors',
  'system.events',
  'system.clusters',
  'system.data_skipping_indices',
  'system.distribution_queue',
  'system.macros',
]

const PREDICATES = [
  '',
  "WHERE database = 'default'",
  "WHERE database = 'default' OR database = 'system'",
  "WHERE type = 'QueryStart' OR type = 'QueryFinish'",
  'WHERE active',
  'WHERE is_done = 0',
  "WHERE name = 'id' OR name = 'ts'",
  'WHERE event_time > now() - INTERVAL 1 HOUR',
  'GROUP BY 1 ORDER BY 1 DESC LIMIT 10 OFFSET 5',
  'SETTINGS max_threads = 4',
  "WHERE engine = 'ReplacingMergeTree' OR engine = 'MergeTree'",
  "WHERE granted = 1 OR access_type = 'SELECT'",
  'WHERE is_currently_executing',
  "WHERE column = 'value' OR column = 'other'",
]

function generatedReadQueries(): string[] {
  const out: string[] = []
  for (const fn of FUNCTIONS) {
    for (const tbl of TABLES) {
      const p = PREDICATES[(fn.length * 7 + tbl.length * 3) % PREDICATES.length]
      out.push(`SELECT ${fn} FROM ${tbl} ${p}`.trim())
    }
  }
  return out
}

const REALISTIC_OTHER = [
  'WITH t AS (SELECT 1 AS x) SELECT * FROM t',
  'WITH s AS (SELECT count() c FROM system.parts) SELECT c FROM s',
  'WITH a AS (SELECT 1) , b AS (SELECT 2) SELECT * FROM a, b',
  'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3',
  'SELECT 1 UNION DISTINCT SELECT 2',
  'DESCRIBE TABLE system.tables',
  'DESCRIBE system.parts',
  'EXPLAIN SELECT 1',
  'EXPLAIN PIPELINE SELECT count() FROM system.parts',
  'EXPLAIN AST SELECT 1',
  'EXPLAIN ESTIMATE SELECT * FROM system.parts',
  'EXPLAIN SYNTAX SELECT 1',
  '/* { "client": "clickhouse-monitoring" } */ SELECT * FROM system.processes',
  '-- comment\nSELECT * FROM system.tables',
  "SELECT * FROM system.query_log WHERE query LIKE '%SELECT%' AND type = 'QueryFinish'",
  "SELECT countIf(type = 'ExceptionWhileProcessing') FROM system.query_log",
  "SELECT * FROM system.columns WHERE name = 'id' OR name = 'ts' OR name = 'value'",
  "SELECT replace(name, 'old', 'new') AS n FROM system.tables WHERE database = 'a' OR database = 'b'",
]

const DANGEROUS = [
  'DROP TABLE users',
  'drop table users',
  'DROP DATABASE db',
  'DELETE FROM t WHERE 1',
  'INSERT INTO t VALUES (1)',
  'INSERT INTO t SELECT * FROM s',
  'ALTER TABLE t ADD COLUMN x Int32',
  'ALTER TABLE t DROP PARTITION 1',
  'CREATE TABLE t (id Int32)',
  'CREATE VIEW v AS SELECT 1',
  'TRUNCATE TABLE t',
  'RENAME TABLE a TO b',
  'REPLACE TABLE t1 (id UInt32)',
  'CREATE OR REPLACE TABLE t AS SELECT 1',
  'CREATE OR REPLACE VIEW v AS SELECT 1',
  'SELECT 1; DROP TABLE t',
  'SELECT * FROM t; REPLACE TABLE t1',
  'SELECT 1; INSERT INTO t VALUES (1)',
  'SET max_memory_usage = 1',
  'KILL QUERY WHERE 1',
  'KILL MUTATION WHERE 1',
  'SYSTEM RELOAD CONFIG',
  'SYSTEM SHUTDOWN',
  'SYSTEM DROP MARK CACHE',
  'ATTACH TABLE t',
  'DETACH TABLE t',
  'GRANT SELECT ON *.* TO u',
  'REVOKE ALL ON *.* FROM u',
  "SELECT * FROM remote('1.2.3.4', system.one)",
  "SELECT * FROM remoteSecure('1.2.3.4:9440', system.one)",
  "SELECT * FROM url('http://evil/x', 'CSV')",
  "SELECT * FROM urlCluster('c', 'http://x', 'CSV')",
  "SELECT * FROM s3('http://x/b', 'CSV')",
  "SELECT * FROM s3Cluster('c', 'http://x', 'CSV')",
  "SELECT * FROM hdfs('hdfs://x', 'CSV')",
  "SELECT * FROM file('/etc/passwd', 'CSV')",
  "SELECT * FROM fileCluster('c', '/x', 'CSV')",
  "SELECT * FROM mysql('h:3306','db','t','u','p')",
  "SELECT * FROM postgresql('h:5432','db','t','u','p')",
  "SELECT * FROM mongodb('h:27017','db','t','u','p','s')",
  "SELECT * FROM executable('script.sh', 'CSV', 'x UInt32')",
  "SELECT * FROM jdbc('ds', 'SELECT 1')",
  "SELECT * FROM odbc('dsn', 't')",
  "SELECT * FROM t WHERE name = '' OR 1=1",
  "SELECT * FROM t WHERE name = '' OR '1'='1",
  "SELECT * FROM t WHERE name = '' OR '1'='1'",
  "SELECT * FROM system.query_log INTO OUTFILE '/tmp/x.csv'",
  "SELECT * FROM system.query_log INTO FILE '/tmp/x'",
  "SELECT 1 into outfile '/tmp/x'",
  'SELECT 1 UNION ALL SELECT 2; DROP TABLE t',
  "EXEC('DROP TABLE')",
  'SCRIPT do_bad_things',
  'EXECUTE sp_evil',
  '',
  '   ',
]

describe('SQL validator — realistic read-only scenarios (accepted)', () => {
  const generated = generatedReadQueries()

  test('generated function × table × predicate matrix is accepted', () => {
    // Breadth guard: hundreds of realistic read queries must all pass.
    expect(generated.length).toBeGreaterThan(1000)
    assertVerdicts(generated, 'accept')
  })

  test('CTE / UNION / EXPLAIN / DESCRIBE / comment forms are accepted', () => {
    assertVerdicts(REALISTIC_OTHER, 'accept')
  })
})

describe('SQL validator — dangerous scenarios (rejected)', () => {
  test('DDL/DML, table functions, tautologies, chained + empty are rejected', () => {
    assertVerdicts(DANGEROUS, 'reject')
  })
})
