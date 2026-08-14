/**
 * Query Config Types Tests
 *
 * Tests for version-aware SQL definition types and helpers.
 */

import type { QueryConfigLike, VersionedSql } from '../query-config-types'

import { getAllSqlStrings } from '../query-config-types'
import { describe, expect, it } from 'bun:test'

describe('getAllSqlStrings', () => {
  describe('string input', () => {
    it('should return single-element array for plain SQL string', () => {
      expect(getAllSqlStrings('SELECT 1')).toEqual(['SELECT 1'])
    })

    it('should return empty string in array', () => {
      expect(getAllSqlStrings('')).toEqual([''])
    })

    it('should handle complex SELECT query', () => {
      const sql =
        'SELECT user_id, count() AS cnt FROM system.query_log GROUP BY user_id ORDER BY cnt DESC LIMIT 10'
      expect(getAllSqlStrings(sql)).toEqual([sql])
    })

    it('should handle multi-line SQL', () => {
      const sql = `SELECT
        user_id,
        count()
      FROM system.query_log
      GROUP BY user_id`
      expect(getAllSqlStrings(sql)).toEqual([sql])
    })
  })

  describe('VersionedSql array input', () => {
    it('should extract SQL from single versioned entry', () => {
      const versions: VersionedSql[] = [
        { since: '23.8', sql: 'SELECT a FROM t' },
      ]
      expect(getAllSqlStrings(versions)).toEqual(['SELECT a FROM t'])
    })

    it('should extract SQL from multiple versioned entries', () => {
      const versions: VersionedSql[] = [
        { since: '23.8', sql: 'SELECT a FROM t' },
        { since: '24.1', sql: 'SELECT a, b FROM t' },
      ]
      expect(getAllSqlStrings(versions)).toEqual([
        'SELECT a FROM t',
        'SELECT a, b FROM t',
      ])
    })

    it('should extract SQL from three versioned entries', () => {
      const versions: VersionedSql[] = [
        { since: '23.8', sql: 'SELECT a FROM t' },
        { since: '24.1', sql: 'SELECT a, b FROM t' },
        { since: '24.5', sql: 'SELECT a, b, c FROM t' },
      ]
      expect(getAllSqlStrings(versions)).toEqual([
        'SELECT a FROM t',
        'SELECT a, b FROM t',
        'SELECT a, b, c FROM t',
      ])
    })

    it('should handle empty versioned array', () => {
      expect(getAllSqlStrings([])).toEqual([])
    })

    it('should preserve description and columns in the objects', () => {
      const versions: VersionedSql[] = [
        {
          since: '24.1',
          sql: 'SELECT new_col FROM t',
          description: 'Added new_col',
          columns: ['new_col'],
        },
      ]
      // getAllSqlStrings only returns SQL strings, not the full objects
      expect(getAllSqlStrings(versions)).toEqual(['SELECT new_col FROM t'])
    })

    it('should handle versioned entries with same since value', () => {
      const versions: VersionedSql[] = [
        { since: '24.1', sql: 'SELECT a FROM t' },
        { since: '24.1', sql: 'SELECT b FROM t' },
      ]
      expect(getAllSqlStrings(versions)).toEqual([
        'SELECT a FROM t',
        'SELECT b FROM t',
      ])
    })
  })

  describe('type compatibility', () => {
    it('VersionedSql should have required fields', () => {
      const v: VersionedSql = {
        since: '24.1',
        sql: 'SELECT 1',
      }
      expect(v.since).toBe('24.1')
      expect(v.sql).toBe('SELECT 1')
    })

    it('VersionedSql should accept optional fields', () => {
      const v: VersionedSql = {
        since: '24.1',
        sql: 'SELECT 1',
        description: 'Test query',
        columns: ['1'],
      }
      expect(v.description).toBe('Test query')
      expect(v.columns).toEqual(['1'])
    })

    it('QueryConfigLike should accept string sql', () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT 1',
      }
      expect(config.sql).toBe('SELECT 1')
    })

    it('QueryConfigLike should accept VersionedSql array', () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: [{ since: '24.1', sql: 'SELECT 1' }],
      }
      expect(Array.isArray(config.sql)).toBe(true)
    })

    it('QueryConfigLike should accept optional fields', () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT 1',
        optional: true,
        tableCheck: 'system.query_log',
      }
      expect(config.optional).toBe(true)
      expect(config.tableCheck).toBe('system.query_log')
    })

    it('QueryConfigLike should accept columnCheck', () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT 1',
        optional: true,
        tableCheck: 'system.metric_log',
        columnCheck: 'system.metric_log.CurrentMetric_ReplicasMaxAbsoluteDelay',
      }
      expect(config.columnCheck).toBe(
        'system.metric_log.CurrentMetric_ReplicasMaxAbsoluteDelay'
      )
    })

    it('QueryConfigLike should accept tableCheck as array', () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT 1',
        tableCheck: ['system.query_log', 'system.processes'],
      }
      expect(Array.isArray(config.tableCheck)).toBe(true)
    })
  })

  describe('real-world patterns', () => {
    it('should extract SQL from versioned query_log config', () => {
      const versions: VersionedSql[] = [
        {
          since: '23.8',
          sql: 'SELECT query_id, user, query_duration_ms FROM system.query_log',
        },
        {
          since: '24.1',
          sql: 'SELECT query_id, user, query_duration_ms, peak_threads_usage FROM system.query_log',
          description: 'Added peak_threads_usage column',
        },
        {
          since: '24.3',
          sql: 'SELECT query_id, user, query_duration_ms, peak_threads_usage, query_cache_usage FROM system.query_log',
          description: 'Added query_cache_usage column',
          columns: [
            'query_id',
            'user',
            'query_duration_ms',
            'peak_threads_usage',
            'query_cache_usage',
          ],
        },
      ]

      const sqls = getAllSqlStrings(versions)
      expect(sqls).toHaveLength(3)
      expect(sqls[0]).not.toContain('peak_threads_usage')
      expect(sqls[1]).toContain('peak_threads_usage')
      expect(sqls[1]).not.toContain('query_cache_usage')
      expect(sqls[2]).toContain('query_cache_usage')
    })

    it('should handle single-version config used as string', () => {
      const config: QueryConfigLike = {
        name: 'simple_query',
        sql: 'SELECT count() FROM system.tables',
      }
      expect(getAllSqlStrings(config.sql!)).toEqual([
        'SELECT count() FROM system.tables',
      ])
    })
  })
})
