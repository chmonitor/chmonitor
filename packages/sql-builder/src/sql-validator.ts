/**
 * SQL Validators
 *
 * Validation utilities for SQL queries to prevent injection attacks.
 *
 * @module @chm/sql-builder/sql-validator
 */

/**
 * SQL injection patterns to detect and prevent
 *
 * These patterns are used to identify potentially dangerous SQL operations.
 * The validator allows SELECT queries, WITH (CTE) clauses, DESCRIBE, and EXPLAIN commands.
 *
 * @constant
 * @readonly
 */
export const SQL_PATTERNS = {
  /**
   * Dangerous SQL keywords that modify data or schema
   *
   * Note: `REPLACE` is intentionally NOT listed here. ClickHouse exposes a
   * read-only `replace()` / `replaceRegexpAll()` string function, and the bare
   * `replace(` call collides with a `\bREPLACE\b` keyword match. The dangerous
   * DDL forms are still blocked: statement-level `REPLACE TABLE` fails the
   * "must start with SELECT/WITH/DESCRIBE/EXPLAIN" check, `CREATE OR REPLACE`
   * is caught by `CREATE`, and chained `; REPLACE` is caught by
   * {@link SQL_PATTERNS.CHAINED_DANGEROUS}.
   */
  DANGEROUS_KEYWORDS:
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|RENAME)\b/i,

  /**
   * SQL execution commands
   */
  EXECUTION_COMMANDS: /\b(EXEC|EXECUTE|SCRIPT)\b/i,

  /**
   * SQL comment patterns that can hide malicious code
   */
  LINE_COMMENT: /--(\s|$)/,
  BLOCK_COMMENT_START: /\/\*/,
  BLOCK_COMMENT_END: /\*\//,

  /**
   * Chained dangerous statements
   */
  CHAINED_DANGEROUS:
    /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|RENAME|REPLACE)/i,

  /**
   * SQL injection via string manipulation
   *
   * The OR-comparison patterns detect a literal-to-literal comparison guarded
   * by OR — the shape of a tautology bypass such as `' OR '1'='1` or
   * `" OR "a"="a`. They deliberately require a quoted/numeric literal (not an
   * identifier) on the left of `=` so that ordinary disjunctive filters like
   * `type = 'A' OR type = 'B'` are NOT flagged. The standalone numeric
   * tautology `OR 1=1` is covered by {@link SQL_PATTERNS.TAUTOLOGY}.
   */
  STRING_INJECTION_SINGLE: /';.*--/,
  STRING_INJECTION_DOUBLE: /\bOR\s+("[^"]*"?|\d+)\s*=\s*("[^"]*"?|\d+)/i,
  STRING_INJECTION_OR_SINGLE: /\bOR\s+('[^']*'?|\d+)\s*=\s*('[^']*'?|\d+)/i,

  /**
   * Tautology attacks (always true conditions)
   */
  TAUTOLOGY: /\bor\s+1\s*=\s*1\b/i,

  /**
   * UNION-based injection attacks
   *
   * Kept for reference/back-compat but NOT enforced (see
   * {@link SQL_INJECTION_PATTERNS}). This validator gates the whole query to
   * SELECT/WITH/DESCRIBE/EXPLAIN, so `SELECT secret FROM system.users` is
   * already permitted on its own — a `UNION ALL SELECT` of the same adds no
   * read surface, while legitimate queries (and several shipped query-configs)
   * use `UNION ALL SELECT` routinely.
   */
  UNION_INJECTION: /\bunion\s+(all\s+)?select\b/i,

  /** ClickHouse SET commands that modify server behavior */
  SET_COMMAND: /\bSET\b/i,

  /** ClickHouse SYSTEM commands (RELOAD, SHUTDOWN, etc.) - not system.table references */
  SYSTEM_COMMAND:
    /\bSYSTEM\s+(RELOAD|SHUTDOWN|KILL|FLUSH|SYNC|START|STOP|DROP)\b/i,

  /** KILL queries that terminate running operations */
  KILL_COMMAND: /\bKILL\b/i,

  /** ATTACH/DETACH operations on tables and databases */
  ATTACH_DETACH: /\b(ATTACH|DETACH)\b/i,

  /** GRANT/REVOKE permission operations */
  PERMISSION_COMMANDS: /\b(GRANT|REVOKE)\b/i,

  /** Dangerous ClickHouse table functions that access external resources */
  DANGEROUS_FUNCTIONS:
    /\b(remote|remoteSecure|url|urlCluster|s3|s3Cluster|hdfs|input|jdbc|odbc|mysql|postgresql|file|fileCluster|executable|mongodb|redis|azureBlobStorage|gcs)\s*\(/i,
} as const

/**
 * Array of all SQL injection patterns for iteration
 *
 * @internal
 */
const SQL_INJECTION_PATTERNS = [
  SQL_PATTERNS.DANGEROUS_KEYWORDS,
  SQL_PATTERNS.EXECUTION_COMMANDS,
  SQL_PATTERNS.CHAINED_DANGEROUS,
  SQL_PATTERNS.STRING_INJECTION_SINGLE,
  SQL_PATTERNS.STRING_INJECTION_OR_SINGLE,
  SQL_PATTERNS.STRING_INJECTION_DOUBLE,
  SQL_PATTERNS.TAUTOLOGY,
  // UNION_INJECTION intentionally omitted: the query is already gated to
  // SELECT/WITH and `UNION ALL SELECT` adds no read surface (see its docstring).
  SQL_PATTERNS.SET_COMMAND,
  SQL_PATTERNS.SYSTEM_COMMAND,
  SQL_PATTERNS.KILL_COMMAND,
  SQL_PATTERNS.ATTACH_DETACH,
  SQL_PATTERNS.PERMISSION_COMMANDS,
  SQL_PATTERNS.DANGEROUS_FUNCTIONS,
]

/**
 * Strip SQL comments to their whitespace equivalent, leaving string literals and
 * quoted identifiers untouched.
 *
 * ClickHouse treats a comment as insignificant whitespace between tokens, so a
 * `/* ... *\/` block or `--` / `#` line comment placed between a function name and
 * its `(` (e.g. `remote/*x*\/(...)`) parses identically to `remote(...)`. The
 * keyword/function blocklists below only see raw text, so without normalization a
 * comment can be used to break up an otherwise-blocked token. Replacing each
 * comment with a single space mirrors ClickHouse's own tokenization: it re-joins
 * `remote/**\/(` into a matchable `remote (`, while a comment placed *inside* an
 * identifier (`remo/**\/te`) stays split — exactly as ClickHouse would read it.
 *
 * Comment markers are only honored outside string literals (`'...'`), quoted
 * identifiers (`"..."`), and backtick identifiers (`` `...` ``), so a benign
 * literal like `'a -- b'` or `'/* not a comment *\/'` is preserved verbatim and
 * never produces a false positive.
 *
 * @param sql - The raw SQL string
 * @returns The SQL with all comments replaced by single spaces
 * @internal
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  // Active string/identifier quote char, or null when in normal SQL context.
  let quote: "'" | '"' | '`' | null = null

  while (i < n) {
    const ch = sql[i]

    if (quote !== null) {
      // Inside a string literal or quoted identifier: copy verbatim, honoring
      // both backslash escapes (\' \" \`) and SQL-standard doubled quotes ('').
      if (ch === '\\' && i + 1 < n) {
        out += ch + sql[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          // Doubled quote is an escaped quote, still inside the literal.
          out += ch + sql[i + 1]
          i += 2
          continue
        }
        quote = null
      }
      out += ch
      i += 1
      continue
    }

    // Normal SQL context: detect comment openers before anything else.
    if (ch === '/' && sql[i + 1] === '*') {
      // Block comment: skip until the matching */ (or end of input).
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2 // consume the closing */ (harmless if we hit EOF first)
      out += ' '
      continue
    }
    if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
      // Line comment (`--` or `#`): skip until newline, which is preserved.
      i += ch === '#' ? 1 : 2
      while (i < n && sql[i] !== '\n') i += 1
      out += ' '
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    }
    out += ch
    i += 1
  }

  return out
}

/**
 * Validate SQL query for basic safety and correctness
 *
 * Detects common SQL injection patterns and ensures the query is non-empty.
 * Only SELECT queries, WITH (CTE) clauses, DESCRIBE, and EXPLAIN commands are allowed.
 *
 * @param sql - The SQL query string to validate
 * @throws {Error} If the query contains suspicious patterns or is invalid
 *
 * @example
 * ```ts
 * // Valid queries
 * validateSqlQuery('SELECT * FROM system.users')
 * validateSqlQuery('SELECT count() FROM system.tables WHERE name = {name:String}')
 * validateSqlQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')
 * validateSqlQuery('DESCRIBE TABLE system.tables')
 * validateSqlQuery('EXPLAIN PIPELINE SELECT 1')
 * validateSqlQuery('EXPLAIN AST SELECT 1')
 *
 * // Invalid queries - throws errors
 * validateSqlQuery('') // Throws: "SQL query cannot be empty"
 * validateSqlQuery('   ') // Throws: "SQL query cannot be empty"
 * validateSqlQuery('DROP TABLE users') // Throws: "Potentially dangerous SQL detected"
 * validateSqlQuery("SELECT * FROM users WHERE name = '' OR 1=1 --'") // Throws
 * ```
 */
export function validateSqlQuery(sql: string): void {
  // Check for empty query
  if (!sql || sql.trim().length === 0) {
    throw new Error('SQL query cannot be empty')
  }

  // Normalize comments away BEFORE running keyword/function detection. A block or
  // line comment placed between a blocked token and its `(` (e.g. `remote/*x*/(`)
  // otherwise slips past `\s*\(` while parsing identically for ClickHouse. String
  // literals are left intact so benign `'-- text'` / `'/* text */'` don't trip the
  // patterns. See {@link stripSqlComments}.
  const normalized = stripSqlComments(sql)

  // Check for SQL injection patterns
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error(
        'Potentially dangerous SQL detected. Only SELECT, WITH, DESCRIBE, and EXPLAIN queries are allowed.'
      )
    }
  }

  // Check the statement type on the comment-stripped query so a leading comment
  // (in any position/quantity) cannot disguise the real first keyword.
  const trimmed = normalized.trim().toUpperCase()
  if (
    !trimmed.startsWith('SELECT') &&
    !trimmed.startsWith('WITH') &&
    !trimmed.startsWith('DESCRIBE') &&
    !trimmed.startsWith('EXPLAIN')
  ) {
    throw new Error(
      'Only SELECT, WITH (CTE), DESCRIBE, and EXPLAIN queries are allowed'
    )
  }
}
