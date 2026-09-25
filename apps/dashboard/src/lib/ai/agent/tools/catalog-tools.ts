/**
 * `search_tools` — on-demand discovery of the tool surface (always a core tool).
 *
 * The agent ships its whole tool set in one flat namespace and the system
 * prompt is a flat prose list of names, so the model has no routing help beyond
 * the names. This tool is the same trick `load_skill` already plays for skills:
 * describe what you want, get back the handful of tools that fit, with a
 * one-line summary and when-to-use each.
 *
 * ## Gate contract
 *
 * The factory takes the **already-gated** tool-name list for this request, so
 * the Postgres / PeerDB / control-tool env gates are inherited rather than
 * re-implemented. It never advertises a tool that is not registered this
 * request — otherwise the model would call a tool that does not exist and burn
 * a step on the error.
 *
 * ## Why the whole tool set is still sent
 *
 * `search_tools` is discovery, not a gate. See `catalog.ts` for why the default
 * request still carries every tool: the AI SDK's `ToolLoopAgent` takes a static
 * `tools` map, so a tool discovered here cannot be injected mid-loop. A caller
 * that wants a narrower map uses the existing `disabledTools` / core-only seam.
 */

import { z } from 'zod'

import {
  catalogToolNames,
  type ToolCatalogEntry,
  TOOL_CATALOG,
  TOOL_SEARCH_RESULT_LIMIT,
  toolCategories,
} from './catalog'
import { capResultRows, truncationNote } from './helpers'
import { dynamicTool } from 'ai'

/** A tool the model can actually call this request, with its live description. */
export interface AvailableTool {
  name: string
  description: string
}

/**
 * Tokenize a natural-language query into lowercase term fragments. Splits on
 * anything that is not a letter/digit, and also emits `_`/space-split words so
 * `replication slot` matches the `replication_slot` tool name.
 */
function terms(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1)
}

/**
 * Score one catalog entry against the query terms. Signals are weighted so a
 * name hit outranks a keyword hit, which outranks a summary mention. A zero
 * score means "no evidence this tool fits", which keeps the result honest
 * rather than returning the whole catalog under any query.
 */
function scoreEntry(
  entry: ToolCatalogEntry,
  queryTerms: readonly string[]
): number {
  const name = entry.name.toLowerCase()
  const nameParts = new Set(terms(name))
  const nameJoined = name.replace(/_/g, ' ')
  const summary = entry.summary.toLowerCase()
  const keywords = entry.keywords.map((k) => k.toLowerCase())

  let score = 0
  for (const term of queryTerms) {
    if (nameParts.has(term)) score += 10
    if (nameJoined.includes(term)) score += 4
    if (keywords.some((k) => k.includes(term))) score += 3
    if (summary.includes(term)) score += 1
  }
  return score
}

export interface SearchToolsResult {
  query: string
  category: string | null
  /** Every gated-in tool the model could still call, not just the matches. */
  callable_tool_count: number
  matched: number
  results: {
    name: string
    category: string
    summary: string
    description: string
    core: boolean
    score: number
  }[]
  /** Names offered by the catalog but not registered this request. */
  unavailable_due_to_gates: string[]
  truncated: boolean
  note?: string
  categories: string[]
}

/**
 * Create the `search_tools` tool bound to the tools registered this request.
 *
 * `available` is the caller's post-gate tool map, so the result can never
 * advertise an unregistered tool.
 */
export function createSearchTools(
  available: Record<string, { description?: string }>
): { search_tools: ReturnType<typeof dynamicTool> } {
  const registered = new Set(Object.keys(available))

  return {
    search_tools: dynamicTool({
      description:
        'Find the agent tool that fits a task, when the tool name is not obvious. Describe what you want to do in plain language and get back the matching tools, each with a one-line summary and when to use it. Use this BEFORE falling back to hand-writing `query` SQL, and before concluding a capability does not exist. Only tools actually available in this conversation are returned — a gated-off tool (destructive control actions, cross-source Postgres, PeerDB) never appears.',
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .describe(
            'What you want to do, in plain language (e.g. "which replication slot is lagging", "recommend a skip index", "chart query volume per hour"). Omit to list the core tools and the available categories.'
          ),
        category: z
          .enum(toolCategories())
          .optional()
          .describe(
            'Restrict results to one category. Use when the query is ambiguous and the category is known.'
          ),
        includeCore: z
          .boolean()
          .optional()
          .describe(
            'Set false to exclude the always-present core tools from the results, so you can see only the discoverable long tail. Defaults to true.'
          ),
      }),
      execute: async (input: unknown) => {
        const {
          query = '',
          category,
          includeCore = true,
        } = input as {
          query?: string
          category?: string
          includeCore?: boolean
        }
        const trimmed = query.trim()
        const queryTerms = terms(trimmed)
        const unavailable = catalogToolNames().filter(
          (n) => !registered.has(n)
        )

        const candidates = catalogToolNames()
          .map((name) => TOOL_CATALOG[name])
          .filter((entry): entry is ToolCatalogEntry => Boolean(entry))
          .filter((entry) => registered.has(entry.name))
          .filter((entry) => includeCore || !entry.core)
          .filter((entry) => !category || entry.category === category)

        // No query and no category: return the core set in catalog order, which
        // is the useful answer to "what can I do?".
        const ranked =
          queryTerms.length === 0
            ? candidates
            : candidates
                .map((entry) => ({ entry, score: scoreEntry(entry, queryTerms) }))
                .filter((r) => r.score > 0)
                .sort(
                  (a, b) =>
                    b.score - a.score ||
                    // Stable, deterministic tiebreak by name.
                    (a.entry.name < b.entry.name ? -1 : 1)
                )
                .map((r) => r.entry)

        const { data: results, truncated } = capResultRows(
          ranked,
          TOOL_SEARCH_RESULT_LIMIT
        )

        return {
          query: trimmed,
          category: category ?? null,
          callable_tool_count: registered.size,
          matched: ranked.length,
          results: results.map((entry) => ({
            name: entry.name,
            category: entry.category,
            summary: entry.summary,
            description: available[entry.name]?.description ?? '',
            core: entry.core,
            score: scoreEntry(entry, queryTerms),
          })),
          unavailable_due_to_gates: unavailable,
          truncated,
          categories: toolCategories(),
          ...(truncated && { note: truncationNote(TOOL_SEARCH_RESULT_LIMIT) }),
        } satisfies SearchToolsResult
      },
    }),
  }
}
