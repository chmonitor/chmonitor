import { z } from 'zod'

import { dynamicTool } from 'ai'
import { getSqlForDisplay, queries } from '@/lib/query-config'

/**
 * find_reference_query — retrieval over the built-in `QueryConfig` catalog.
 *
 * The dashboard ships 100+ vetted, version-aware SQL statements (the same ones
 * the monitoring pages run). Rather than hand-writing `system.*` SQL from
 * scratch, the agent can look up the closest existing config and adapt its
 * known-good, version-safe SQL. This is a read-only, deterministic,
 * keyword-overlap lookup — no ClickHouse round-trip.
 */

interface ScoredConfig {
  name: string
  description: string
  score: number
  sql: string
}

const MIN_TOKEN_LENGTH = 3
const DEFAULT_LIMIT = 5
const MAX_SQL_CHARS = 1200

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (t) => t.length >= MIN_TOKEN_LENGTH
  )
}

/**
 * Score a query config against the search tokens.
 *
 * A hit in the config `name` is weighted highest (it is the human label), a hit
 * in the `description` next, and a hit anywhere in the SQL body lowest — enough
 * to surface a relevant table/function match without letting a long query
 * dominate purely by length.
 */
function scoreConfig(
  config: (typeof queries)[number],
  searchTokens: readonly string[]
): ScoredConfig {
  const name = config.name ?? ''
  const description = config.description ?? config.docs ?? ''
  const sql = config.sql ? getSqlForDisplay(config.sql) : ''

  const nameTokens = new Set(tokenize(name))
  const descTokens = new Set(tokenize(description))
  const sqlTokens = new Set(tokenize(sql))

  let score = 0
  for (const token of searchTokens) {
    if (nameTokens.has(token)) score += 5
    if (descTokens.has(token)) score += 3
    if (sqlTokens.has(token)) score += 1
  }

  return { name, description, score, sql }
}

export function createReferenceQueryTools() {
  return {
    find_reference_query: dynamicTool({
      description:
        "Search the dashboard's built-in library of 100+ vetted, version-aware ClickHouse monitoring queries and return the closest matches (name, description, and SQL). Use this BEFORE hand-writing system.* SQL for a monitoring question — adapt a known-good reference query instead of reinventing it. Read-only catalog lookup; no query is executed.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'What you are trying to find, in natural language or keywords — e.g. "slow queries by user", "table parts and compression", "replication queue".'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe(`Max matches to return (default ${DEFAULT_LIMIT}).`),
      }),
      execute: async (input: unknown) => {
        const { query, limit } = input as { query: string; limit?: number }
        const searchTokens = tokenize(query)
        const take = limit ?? DEFAULT_LIMIT

        const matches = queries
          .map((config) => scoreConfig(config, searchTokens))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, take)
          .map((m) => ({
            name: m.name,
            description: m.description,
            sql:
              m.sql.length > MAX_SQL_CHARS
                ? `${m.sql.slice(0, MAX_SQL_CHARS)}\n-- …truncated`
                : m.sql,
          }))

        return {
          type: 'reference_queries' as const,
          query,
          matchCount: matches.length,
          matches,
          ...(matches.length === 0
            ? {
                note: 'No reference query matched. Write the SQL with the query tool, guided by load_skill.',
              }
            : {}),
        }
      },
    }),
  }
}
