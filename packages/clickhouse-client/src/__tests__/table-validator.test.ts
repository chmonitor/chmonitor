import type { QueryConfigLike } from '@chm/sql-builder'

import { parseTableFromSQL, validateTableExistence } from '../table-validator'

// Mock the table existence cache
jest.mock('../table-existence-cache', () => ({
  tableExistenceCache: {
    checkTableExists: jest.fn(),
  },
}))

describe('Table Validator', () => {
  describe('parseTableFromSQL', () => {
    it('should extract table names from simple FROM clause', () => {
      const sql =
        'SELECT * FROM system.backup_log WHERE status = "BACKUP_CREATED"'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.backup_log'])
    })

    it('should extract multiple table names from JOINs', () => {
      const sql =
        'SELECT * FROM system.backup_log JOIN system.error_log ON true'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.backup_log', 'system.error_log'])
    })

    it('should handle different JOIN types', () => {
      const sql = `
        SELECT * FROM system.backup_log b
        LEFT JOIN system.error_log e ON b.id = e.id
        RIGHT JOIN system.query_log q ON b.id = q.id
        INNER JOIN system.tables t ON b.database = t.database
        FULL OUTER JOIN system.parts p ON t.name = p.table
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.backup_log')
      expect(result).toContain('system.error_log')
      expect(result).toContain('system.query_log')
      expect(result).toContain('system.tables')
      expect(result).toContain('system.parts')
    })

    it('should extract tables from EXISTS subqueries', () => {
      const sql = `
        SELECT * FROM system.tables t
        WHERE EXISTS (SELECT 1 FROM system.backup_log b WHERE b.name = t.name)
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.tables')
      expect(result).toContain('system.backup_log')
    })

    it('should extract tables from IN subqueries', () => {
      const sql = `
        SELECT * FROM system.tables
        WHERE name IN (SELECT name FROM system.backup_log WHERE status = 'CREATED')
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.tables')
      expect(result).toContain('system.backup_log')
    })

    it('should extract tables from CTE (WITH clause)', () => {
      const sql = `
        WITH recent_backups AS (
          SELECT * FROM system.backup_log WHERE start_time > now() - INTERVAL 1 DAY
        )
        SELECT * FROM recent_backups rb
        JOIN system.tables t ON rb.name = t.name
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.backup_log')
      expect(result).toContain('system.tables')
    })

    it('should extract tables from INSERT statements', () => {
      const sql =
        'INSERT INTO system.monitoring_events (kind, actor) VALUES ("test", "user")'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.monitoring_events'])
    })

    it('should extract tables from UPDATE statements', () => {
      const sql =
        'UPDATE system.monitoring_events SET actor = "new_user" WHERE kind = "test"'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.monitoring_events'])
    })

    it('should extract tables from DELETE statements', () => {
      const sql = 'DELETE FROM system.monitoring_events WHERE kind = "test"'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.monitoring_events'])
    })

    it('should handle case insensitive SQL', () => {
      const sql =
        'select * from System.BACKUP_LOG join system.error_log on true'
      const result = parseTableFromSQL(sql)
      expect(result).toContain('System.BACKUP_LOG')
      expect(result).toContain('system.error_log')
    })

    it('should handle SQL with newlines and extra whitespace', () => {
      const sql = `
        SELECT *
        FROM    system.backup_log
        WHERE   status = 'CREATED'
        ORDER BY start_time DESC
      `
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.backup_log'])
    })

    it('should not extract duplicates', () => {
      const sql = `
        SELECT * FROM system.backup_log b1
        JOIN system.backup_log b2 ON b1.id = b2.parent_id
      `
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.backup_log'])
    })

    it('should handle complex nested queries', () => {
      const sql = `
        WITH backup_summary AS (
          SELECT database, COUNT(*) as backup_count
          FROM system.backup_log
          WHERE status = 'CREATED'
        )
        SELECT t.name, bs.backup_count
        FROM system.tables t
        LEFT JOIN backup_summary bs ON t.database = bs.database
        WHERE EXISTS (
          SELECT 1 FROM system.parts p 
          WHERE p.database = t.database AND p.table = t.name
        )
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.backup_log')
      expect(result).toContain('system.tables')
      expect(result).toContain('system.parts')
    })

    it('should extract table name from merge() table function', () => {
      const sql = "SELECT * FROM merge('system', '^query_log')"
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.query_log'])
    })

    it('should extract table name from merge() combined with a JOIN', () => {
      const sql = `
        SELECT * FROM merge('system', '^error_log') e
        JOIN system.tables t ON e.table = t.name
      `
      const result = parseTableFromSQL(sql)
      expect(result).toContain('system.error_log')
      expect(result).toContain('system.tables')
    })

    it('should not extract duplicates from repeated merge() calls to the same table', () => {
      const sql = `
        SELECT * FROM merge('system', '^query_log') q1
        JOIN merge('system', '^query_log') q2 ON q1.query_id = q2.query_id
      `
      const result = parseTableFromSQL(sql)
      expect(result).toEqual(['system.query_log'])
    })

    it('should handle empty SQL', () => {
      const sql = ''
      const result = parseTableFromSQL(sql)
      expect(result).toEqual([])
    })

    it('should handle SQL without database.table format', () => {
      const sql = 'SELECT * FROM some_view WHERE column = value'
      const result = parseTableFromSQL(sql)
      expect(result).toEqual([])
    })
  })

  describe('validateTableExistence', () => {
    beforeEach(() => {
      // Reset mocks before each test
      jest.clearAllMocks()
    })

    it('should return shouldProceed true when no tables to check', async () => {
      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT * FROM some_view', // No database.table pattern
        columns: ['name'],
        optional: false,
      }

      const result = await validateTableExistence(config, 0)
      expect(result.shouldProceed).toBe(true)
      expect(result.missingTables).toEqual([])
    })

    it('should use explicit tableCheck when provided', async () => {
      const { tableExistenceCache } = await import('../table-existence-cache')
      const mockCheckTableExists =
        tableExistenceCache.checkTableExists as jest.MockedFunction<
          typeof tableExistenceCache.checkTableExists
        >

      // Mock the table existence check to return false
      mockCheckTableExists.mockResolvedValue(false)

      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT * FROM system.backup_log',
        columns: ['name'],
        optional: true,
        tableCheck: 'system.backup_log',
      }

      const result = await validateTableExistence(config, 0)
      expect(result.shouldProceed).toBe(false)
      expect(result.missingTables).toEqual(['system.backup_log'])
      expect(mockCheckTableExists).toHaveBeenCalledWith(
        0,
        'system',
        'backup_log'
      )
    })

    it('should fallback to SQL parsing when tableCheck is not provided', async () => {
      const { tableExistenceCache } = await import('../table-existence-cache')
      const mockCheckTableExists =
        tableExistenceCache.checkTableExists as jest.MockedFunction<
          typeof tableExistenceCache.checkTableExists
        >

      // Mock the table existence check to return false
      mockCheckTableExists.mockResolvedValue(false)

      const config: QueryConfigLike = {
        name: 'test',
        sql: 'SELECT * FROM system.backup_log WHERE status = "BACKUP_CREATED"',
        columns: ['name'],
        optional: true,
        // No tableCheck provided - should use SQL parsing
      }

      const result = await validateTableExistence(config, 0)
      expect(result.shouldProceed).toBe(false)
      expect(result.missingTables).toEqual(['system.backup_log'])
      expect(mockCheckTableExists).toHaveBeenCalledWith(
        0,
        'system',
        'backup_log'
      )
    })
  })
})
