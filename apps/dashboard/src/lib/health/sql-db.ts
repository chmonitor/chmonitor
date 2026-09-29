/**
 * The SQL executor the health/alert stores run on (#3493).
 *
 * {@link HealthSqlDb} is a structural subset of Cloudflare's `D1Database`
 * (`prepare` → `bind` → `all` / `first` / `run`, plus `batch`), so a real D1
 * binding satisfies it unchanged and every store keeps its existing D1 SQL.
 * {@link PostgresHealthDb} implements the same surface on postgres.js for
 * self-hosted deployments that set `DATABASE_URL` / `POSTGRES_URL`:
 *
 *   - `?N` / bare `?` placeholders are rewritten to `$N`.
 *   - booleans bind as `1` / `0` (D1 coerces them; the columns are INTEGER).
 *   - `int8` (BIGINT ms timestamps, `COUNT(*)`) parses to a JS number, not the
 *     postgres.js default string.
 *   - `batch` runs in one transaction, like D1's atomic batch.
 *   - `run().meta.changes` is the postgres.js affected-row count.
 *   - the schema self-bootstraps once per client, before the first statement
 *     (idempotent `CREATE TABLE IF NOT EXISTS` — no migration runner), exactly
 *     like the connection/conversation Postgres stores.
 *
 * postgres.js is loaded with a dynamic `import()` on first use, so the Worker
 * bundle does not grow and constructing the adapter stays synchronous (the
 * stores' `getDb()` is sync — `isSuppressed` reads a cache without awaiting).
 */

export interface HealthSqlResult<T> {
  results: T[]
  success: boolean
  meta: { changes?: number }
}

export interface HealthSqlStatement {
  bind(...values: unknown[]): HealthSqlStatement
  all<T = Record<string, unknown>>(): Promise<HealthSqlResult<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<HealthSqlResult<unknown>>
}

export interface HealthSqlDb {
  prepare(query: string): HealthSqlStatement
  batch(statements: HealthSqlStatement[]): Promise<unknown[]>
}

/**
 * Rewrite SQLite/D1 placeholders to Postgres `$N`. `?N` keeps its index; a
 * bare `?` takes the next sequential index. Placeholders inside single-quoted
 * string literals are left alone.
 */
export function toPostgresPlaceholders(query: string): string {
  let out = ''
  let next = 1
  let inString = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === "'") {
      inString = !inString
      out += ch
      continue
    }
    if (ch !== '?' || inString) {
      out += ch
      continue
    }
    let digits = ''
    while (i + 1 < query.length && /[0-9]/.test(query[i + 1])) {
      digits += query[i + 1]
      i++
    }
    if (digits) {
      out += `$${digits}`
      next = Math.max(next, Number(digits) + 1)
    } else {
      out += `$${next++}`
    }
  }
  return out
}

/** D1 stores booleans as 0/1 and rejects `undefined`; mirror that. */
function toPostgresParam(value: unknown): unknown {
  if (value === true) return 1
  if (value === false) return 0
  if (value === undefined) {
    throw new TypeError('undefined is not a valid SQL parameter')
  }
  return value
}

/** The part of a postgres.js client the adapter uses (injectable for tests). */
export interface PostgresQueryRunner {
  unsafe(
    query: string,
    params?: unknown[]
  ): Promise<Record<string, unknown>[] & { count?: number | null }>
}

export interface PostgresClientLike extends PostgresQueryRunner {
  begin<T>(fn: (tx: PostgresQueryRunner) => Promise<T>): Promise<T>
}

export type PostgresClientFactory = (
  url: string
) => Promise<PostgresClientLike> | PostgresClientLike

/** Real postgres.js client: lazy-imported, pooled, int8 parsed to number. */
export const defaultPostgresClientFactory: PostgresClientFactory = async (
  url
) => {
  const { default: postgres } = await import('postgres')
  return postgres(url, {
    max: 5,
    onnotice: () => {},
    types: {
      int8AsNumber: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  }) as unknown as PostgresClientLike
}

function toResult<T>(
  rows: Record<string, unknown>[] & { count?: number | null }
): HealthSqlResult<T> {
  return {
    results: [...rows] as T[],
    success: true,
    meta: { changes: rows.count ?? rows.length },
  }
}

class PostgresHealthStatement implements HealthSqlStatement {
  constructor(
    private readonly db: PostgresHealthDb,
    readonly query: string,
    readonly params: readonly unknown[] = []
  ) {}

  /** Returns a NEW statement — a prepared statement is reused across binds. */
  bind(...values: unknown[]): HealthSqlStatement {
    return new PostgresHealthStatement(this.db, this.query, values)
  }

  async all<T = Record<string, unknown>>(): Promise<HealthSqlResult<T>> {
    return toResult<T>(await this.db.execute(this))
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await this.db.execute(this)
    return (rows[0] as T | undefined) ?? null
  }

  async run(): Promise<HealthSqlResult<unknown>> {
    return toResult<unknown>(await this.db.execute(this))
  }

  /** Run on an explicit runner (a transaction inside `batch`). */
  runOn(runner: PostgresQueryRunner) {
    return runner.unsafe(
      toPostgresPlaceholders(this.query),
      this.params.map(toPostgresParam)
    )
  }
}

export class PostgresHealthDb implements HealthSqlDb {
  private client: Promise<PostgresClientLike> | null = null
  private ready: Promise<PostgresClientLike> | null = null

  constructor(
    private readonly url: string,
    private readonly schemaSql: string,
    private readonly factory: PostgresClientFactory = defaultPostgresClientFactory
  ) {}

  prepare(query: string): HealthSqlStatement {
    return new PostgresHealthStatement(this, query)
  }

  async batch(statements: HealthSqlStatement[]): Promise<unknown[]> {
    const client = await this.connect()
    return client.begin(async (tx) => {
      const out: unknown[] = []
      for (const stmt of statements) {
        out.push(toResult(await asPostgresStatement(stmt).runOn(tx)))
      }
      return out
    })
  }

  /** @internal */
  async execute(stmt: PostgresHealthStatement) {
    return stmt.runOn(await this.connect())
  }

  /** Client + one-time schema bootstrap (single-flight; retried on failure). */
  private connect(): Promise<PostgresClientLike> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          if (!this.client)
            this.client = Promise.resolve(this.factory(this.url))
          const client = await this.client
          await client.unsafe(this.schemaSql)
          return client
        } catch (err) {
          this.ready = null
          this.client = null
          throw err
        }
      })()
    }
    return this.ready
  }
}

function asPostgresStatement(
  stmt: HealthSqlStatement
): PostgresHealthStatement {
  if (!(stmt instanceof PostgresHealthStatement)) {
    throw new TypeError('batch() only accepts statements from the same db')
  }
  return stmt
}

/**
 * True for the Postgres adapter. Stores use it to skip their SQLite
 * `ensureMigrated` DDL — the Postgres schema is bootstrapped by the adapter.
 */
export function isPostgresHealthDb(db: unknown): db is PostgresHealthDb {
  return db instanceof PostgresHealthDb
}
