/**
 * Minimal ClickHouse HTTP client for the state backend (server-only).
 *
 * Deliberately fetch-based and dependency-free: it runs in both the Node and
 * (theoretical) Workers runtimes, is trivially mockable in unit tests, and
 * keeps the Node-only `@clickhouse/client` package out of any bundle that
 * imports the state stores. Parameters are bound server-side via ClickHouse's
 * `param_*` HTTP query parameters (`{name:Type}` placeholders in SQL) — never
 * string-interpolated.
 */

import type { StateClickHouseConfig } from './config'

export type StateQueryParams = Record<string, string | number>

export class StateClickHouseError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'StateClickHouseError'
  }
}

export interface StateClickHouseExecutor {
  /** Run a statement with no result set (DDL, INSERT, DELETE). */
  command(sql: string, params?: StateQueryParams): Promise<void>
  /** Run a SELECT; rows come back as JSONEachRow objects. */
  query<T>(sql: string, params?: StateQueryParams): Promise<T[]>
}

export class StateClickHouseClient implements StateClickHouseExecutor {
  constructor(private readonly config: StateClickHouseConfig) {}

  private buildUrl(params?: StateQueryParams): URL {
    const url = new URL(this.config.url)
    url.searchParams.set('database', this.config.database)
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(`param_${key}`, String(value))
    }
    return url
  }

  private async execute(
    sql: string,
    params?: StateQueryParams
  ): Promise<string> {
    const response = await fetch(this.buildUrl(params), {
      method: 'POST',
      headers: {
        'X-ClickHouse-User': this.config.user,
        'X-ClickHouse-Key': this.config.password,
        'Content-Type': 'text/plain',
      },
      body: sql,
    })

    const text = await response.text()
    if (!response.ok) {
      throw new StateClickHouseError(
        `ClickHouse state query failed (${response.status}): ${text.slice(0, 500)}`,
        response.status
      )
    }
    return text
  }

  async command(sql: string, params?: StateQueryParams): Promise<void> {
    await this.execute(sql, params)
  }

  async query<T>(sql: string, params?: StateQueryParams): Promise<T[]> {
    const text = await this.execute(`${sql} FORMAT JSONEachRow`, params)
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T)
  }
}
