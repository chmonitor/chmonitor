import { splitSqlStatements, stripTrailingFormat } from '../split-statements'
import { describe, expect, it } from 'bun:test'

describe('splitSqlStatements', () => {
  it('returns a single statement unchanged', () => {
    expect(splitSqlStatements('SELECT * FROM system.tables LIMIT 100')).toEqual(
      ['SELECT * FROM system.tables LIMIT 100']
    )
  })

  it('strips a trailing semicolon (R3)', () => {
    expect(splitSqlStatements('SELECT 1;')).toEqual(['SELECT 1'])
    expect(splitSqlStatements('SELECT 1 ;  ')).toEqual(['SELECT 1'])
    expect(splitSqlStatements('SELECT 1;\n\n')).toEqual(['SELECT 1'])
  })

  it('splits multiple statements (R2)', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
    expect(splitSqlStatements('SELECT 1;\nSELECT 2;\nSELECT 3;')).toEqual([
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ])
  })

  it('ignores empty / whitespace-only fragments between semicolons', () => {
    expect(splitSqlStatements('SELECT 1;;;SELECT 2')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
    expect(splitSqlStatements('  ;  ; SELECT 1 ; ; ')).toEqual(['SELECT 1'])
  })

  it('returns an empty array for blank input', () => {
    expect(splitSqlStatements('')).toEqual([])
    expect(splitSqlStatements('   \n  ')).toEqual([])
    expect(splitSqlStatements(';;;')).toEqual([])
  })

  it('does not split on a semicolon inside a single-quoted string', () => {
    expect(splitSqlStatements("SELECT ';' AS sep")).toEqual([
      "SELECT ';' AS sep",
    ])
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 2")).toEqual([
      "SELECT 'a;b'",
      'SELECT 2',
    ])
  })

  it('handles doubled-quote and backslash escapes inside strings', () => {
    // Doubled single-quote escape: the inner '' is an escaped quote, so the ;
    // stays inside the string literal.
    expect(splitSqlStatements("SELECT 'it''s; ok' AS v")).toEqual([
      "SELECT 'it''s; ok' AS v",
    ])
    // Backslash-escaped quote keeps the string open across the ;.
    expect(splitSqlStatements("SELECT 'a\\'; b' AS v")).toEqual([
      "SELECT 'a\\'; b' AS v",
    ])
  })

  it('does not split on a semicolon inside a double-quoted string', () => {
    expect(splitSqlStatements('SELECT "a;b" AS v')).toEqual([
      'SELECT "a;b" AS v',
    ])
  })

  it('does not split on a semicolon inside a backtick identifier', () => {
    expect(splitSqlStatements('SELECT 1 FROM `weird;name`')).toEqual([
      'SELECT 1 FROM `weird;name`',
    ])
  })

  it('does not split on a semicolon inside a line comment', () => {
    expect(splitSqlStatements('SELECT 1 -- a;b\n; SELECT 2')).toEqual([
      'SELECT 1 -- a;b',
      'SELECT 2',
    ])
  })

  it('does not split on a semicolon inside a block comment', () => {
    expect(splitSqlStatements('SELECT 1 /* a;b */; SELECT 2')).toEqual([
      'SELECT 1 /* a;b */',
      'SELECT 2',
    ])
  })

  // Regression for issue #2949's sibling #2950: `/*/` opened a block comment
  // whose very same `*` was then read as the start of the closing `*/`, so the
  // comment ended immediately and a `;` inside it split one statement into two
  // invalid fragments. The closing `*/` must begin at least 2 chars after the
  // opening `/*`.
  it("does not close a block comment early on '/*/' (#2950)", () => {
    expect(splitSqlStatements('SELECT 1 /*/ ; */ , 2')).toEqual([
      'SELECT 1 /*/ ; */ , 2',
    ])
  })

  it("splits on a real ';' after a '/*/'-opened comment (#2950)", () => {
    expect(splitSqlStatements('SELECT 1 /*/ ; */; SELECT 2')).toEqual([
      'SELECT 1 /*/ ; */',
      'SELECT 2',
    ])
  })

  it('still closes ordinary block comments at the first valid */', () => {
    expect(splitSqlStatements('SELECT 1 /**/; SELECT 2')).toEqual([
      'SELECT 1 /**/',
      'SELECT 2',
    ])
    // Block comments do not nest: `/*/*/` closes at its trailing `*/`.
    expect(splitSqlStatements('SELECT 1 /*/*/; SELECT 2')).toEqual([
      'SELECT 1 /*/*/',
      'SELECT 2',
    ])
  })

  it('drops comment-only trailing fragments', () => {
    expect(splitSqlStatements('SELECT 1; -- trailing note')).toEqual([
      'SELECT 1',
    ])
    expect(splitSqlStatements('SELECT 1; /* note */')).toEqual(['SELECT 1'])
  })

  it('preserves leading comments on a real statement', () => {
    expect(splitSqlStatements('-- header\nSELECT 1')).toEqual([
      '-- header\nSELECT 1',
    ])
  })

  it('handles a realistic multi-statement script', () => {
    const script = `
      -- top databases by size
      SELECT database, formatReadableSize(sum(bytes)) AS size
      FROM system.parts
      WHERE active
      GROUP BY database;

      SELECT count() FROM system.tables;
    `
    expect(splitSqlStatements(script)).toEqual([
      `-- top databases by size
      SELECT database, formatReadableSize(sum(bytes)) AS size
      FROM system.parts
      WHERE active
      GROUP BY database`,
      'SELECT count() FROM system.tables',
    ])
  })
})

describe('stripTrailingFormat', () => {
  it('removes a trailing FORMAT clause', () => {
    expect(stripTrailingFormat('SELECT 1 FORMAT JSONEachRow')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 FORMAT TabSeparated')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 FORMAT Pretty')).toBe('SELECT 1')
  })

  it('is case-insensitive for the FORMAT keyword', () => {
    expect(stripTrailingFormat('SELECT 1 format JSONEachRow')).toBe('SELECT 1')
  })

  it('strips trailing semicolons', () => {
    expect(stripTrailingFormat('SELECT 1;')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 ;  ')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1;;;')).toBe('SELECT 1')
  })

  it('strips a FORMAT clause followed by a semicolon', () => {
    expect(stripTrailingFormat('SELECT 1 FORMAT JSONEachRow;')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 FORMAT JSONEachRow ; ')).toBe(
      'SELECT 1'
    )
  })

  it('leaves non-trailing FORMAT-like tokens intact', () => {
    expect(stripTrailingFormat('SELECT formatDateTime(now())')).toBe(
      'SELECT formatDateTime(now())'
    )
    expect(stripTrailingFormat('SELECT toString(x) AS format FROM t')).toBe(
      'SELECT toString(x) AS format FROM t'
    )
  })

  it('does not strip a trailing `format` identifier followed by a keyword/alias', () => {
    // `format` is a column here, not a FORMAT clause: DESC / f / ASC are not
    // ClickHouse format names, so the tail must be preserved.
    expect(stripTrailingFormat('SELECT * FROM t ORDER BY format DESC')).toBe(
      'SELECT * FROM t ORDER BY format DESC'
    )
    expect(stripTrailingFormat('SELECT * FROM t ORDER BY format ASC')).toBe(
      'SELECT * FROM t ORDER BY format ASC'
    )
    expect(stripTrailingFormat('SELECT format AS f')).toBe('SELECT format AS f')
    expect(stripTrailingFormat('SELECT format f FROM t')).toBe(
      'SELECT format f FROM t'
    )
  })

  it('strips a variety of recognized ClickHouse formats', () => {
    expect(stripTrailingFormat('SELECT 1 FORMAT CSV')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 FORMAT Vertical')).toBe('SELECT 1')
    expect(stripTrailingFormat('SELECT 1 FORMAT PrettyCompact')).toBe(
      'SELECT 1'
    )
    expect(stripTrailingFormat('SELECT 1 FORMAT RowBinary')).toBe('SELECT 1')
  })

  it('does not strip an unrecognized FORMAT name', () => {
    // Guard against truncating valid SQL whose trailing token only looks like a
    // FORMAT clause; only known formats are removed.
    expect(stripTrailingFormat('SELECT 1 FORMAT NotARealFormat')).toBe(
      'SELECT 1 FORMAT NotARealFormat'
    )
  })

  it('handles a realistic copied console query', () => {
    expect(
      stripTrailingFormat(
        "SELECT database, name FROM system.tables WHERE database NOT IN ('system') ORDER BY total_bytes DESC LIMIT 500 FORMAT JSONEachRow"
      )
    ).toBe(
      "SELECT database, name FROM system.tables WHERE database NOT IN ('system') ORDER BY total_bytes DESC LIMIT 500"
    )
  })
})
