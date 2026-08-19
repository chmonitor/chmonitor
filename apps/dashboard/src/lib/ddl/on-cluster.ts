/**
 * Recommend-only local vs ON CLUSTER DDL variants.
 *
 * Pure string transform: never executes, applies, or mutates anything.
 * Used by Query Advisor, schema-tuning findings, and schema-diff plan items
 * when cluster topology is known (Distributed engine or cluster metadata).
 */

import { parseDistributedEngine } from '@/lib/explorer/engine-kind'

/** Cluster context for copyable ON CLUSTER variants. `null` = single-host. */
export type ClusterTopology = {
  cluster: string
  /** Local table when the analyzed object is a Distributed wrapper. */
  localDatabase?: string
  localTable?: string
} | null

export type ClusterDdlAnnotation = {
  /** Qualified local table (`db.table`) when topology names one, else null. */
  localTableName: string | null
  /** Single-host statement (rewritten onto the local table when needed). */
  statement: string
  /** Copyable ON CLUSTER variant of the same statement, or null. */
  onClusterStatement: string | null
  /** Why ON CLUSTER was not offered (null when the variant exists). */
  localOnlyReason: string | null
}

const TABLE_DDL_PREFIX =
  /^((?:ALTER|CREATE(?:\s+TEMPORARY)?|ATTACH|DETACH|RENAME|TRUNCATE|OPTIMIZE)\s+(?:TABLE|MATERIALIZED\s+VIEW)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+)((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w$]*))?)(\s+)([\s\S]+)$/i

function quoteClusterName(cluster: string): string {
  const trimmed = cluster.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return `'${trimmed.replace(/'/g, "\\'")}'`
  }
  return `'${trimmed.replace(/'/g, "\\'")}'`
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function qualifiedLocal(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function parseTableDdl(statement: string) {
  return statement
    .trim()
    .replace(/;+\s*$/, '')
    .match(TABLE_DDL_PREFIX)
}

/**
 * Insert `ON CLUSTER 'name'` after the table identifier. Returns null when
 * the statement is not table DDL (settings, PREWHERE rewrites, empty).
 */
export function insertOnClusterClause(
  statement: string,
  cluster: string
): string | null {
  const trimmed = statement.trim()
  if (!trimmed || !cluster.trim()) return null
  if (/\bON\s+CLUSTER\b/i.test(trimmed)) return trimmed
  const match = parseTableDdl(trimmed)
  if (!match) return null
  const [, prefix, tableIdent, space, rest] = match
  const trailingSemi = /;\s*$/.test(statement.trim()) ? ';' : ''
  return `${prefix}${tableIdent}${space}ON CLUSTER ${quoteClusterName(cluster)} ${rest}${trailingSemi}`
}

/**
 * Point table DDL at a local table (Distributed wrapper → inner table).
 * Non-DDL statements are returned unchanged.
 */
export function rewriteDdlTableName(
  statement: string,
  database: string,
  table: string
): string {
  const trimmed = statement.trim()
  const match = parseTableDdl(trimmed)
  if (!match) return trimmed
  const [, prefix, , space, rest] = match
  const trailingSemi = /;\s*$/.test(trimmed) ? ';' : ''
  return `${prefix}${qualifiedLocal(database, table)}${space}${rest}${trailingSemi}`
}

export function topologyFromDistributedTable(opts: {
  engine?: string | null
  engineFull?: string | null
  createTableQuery?: string | null
}): ClusterTopology {
  const fromFull = parseDistributedEngine(opts.engineFull)
  if (fromFull) {
    return {
      cluster: fromFull.cluster,
      localDatabase: fromFull.database,
      localTable: fromFull.table,
    }
  }

  const create = opts.createTableQuery?.trim() ?? ''
  if (create) {
    const engineMatch = create.match(
      /ENGINE\s*=\s*(Distributed\s*\([\s\S]*\))/i
    )
    const fromCreate = parseDistributedEngine(engineMatch?.[1] ?? create)
    if (fromCreate) {
      return {
        cluster: fromCreate.cluster,
        localDatabase: fromCreate.database,
        localTable: fromCreate.table,
      }
    }
  }

  if (opts.engine && /Distributed/i.test(opts.engine)) {
    const fromEngine = parseDistributedEngine(opts.engine)
    if (fromEngine) {
      return {
        cluster: fromEngine.cluster,
        localDatabase: fromEngine.database,
        localTable: fromEngine.table,
      }
    }
  }

  return null
}

/**
 * Annotate a recommend-only statement with a local table name and a copyable
 * ON CLUSTER variant when topology is known. Single-node / empty topology
 * returns the original statement unchanged.
 *
 * This function does not execute SQL and must not grow I/O.
 */
export function annotateDdlForTopology(
  statement: string,
  topology: ClusterTopology
): ClusterDdlAnnotation {
  const original = statement.trim()
  if (!original) {
    return {
      localTableName: null,
      statement: original,
      onClusterStatement: null,
      localOnlyReason: null,
    }
  }

  if (!topology?.cluster?.trim()) {
    return {
      localTableName: null,
      statement: original,
      onClusterStatement: null,
      localOnlyReason: null,
    }
  }

  const localDatabase = topology.localDatabase?.trim()
  const localTable = topology.localTable?.trim()
  const localTableName =
    localDatabase && localTable ? `${localDatabase}.${localTable}` : null

  let localStatement = original
  if (localDatabase && localTable) {
    localStatement = rewriteDdlTableName(original, localDatabase, localTable)
  }

  const onClusterStatement = insertOnClusterClause(
    localStatement,
    topology.cluster
  )
  if (!onClusterStatement) {
    return {
      localTableName,
      statement: original,
      onClusterStatement: null,
      localOnlyReason:
        'This statement is not table DDL, so ON CLUSTER does not apply — run it on a single node.',
    }
  }

  return {
    localTableName,
    statement: localStatement,
    onClusterStatement,
    localOnlyReason: null,
  }
}
