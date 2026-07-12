/**
 * Suggested prompt entries shown on the AI Agent welcome screen and the
 * right-hand sidebar's "Suggested prompts" section.
 *
 * `category` is shown as a short tag (e.g. INSIGHTS, SCHEMA, STORAGE) so the
 * user can scan by intent. `prompt` is the full text injected into the
 * composer when the user clicks the entry.
 */

export interface SuggestedPrompt {
  category: string
  title: string
  prompt: string
}

export const SUGGESTED_PROMPTS: readonly SuggestedPrompt[] = [
  {
    category: 'INSIGHTS',
    title: 'Largest scan ever',
    prompt: "What's the largest data scan ever performed on this cluster?",
  },
  {
    category: 'SCHEMA',
    title: 'Database overview',
    prompt: 'What databases are available and which ones have the most tables?',
  },
  {
    category: 'STORAGE',
    title: 'Top 10 by disk',
    prompt: 'Show me the 10 largest tables and their disk usage',
  },
  {
    category: 'QUERIES',
    title: 'What is running',
    prompt:
      'Which queries are running right now and how long have they been executing?',
  },
  {
    category: 'QUERIES',
    title: 'Slowest in 24h',
    prompt: 'What are the slowest queries from the past 24 hours?',
  },
  {
    category: 'ERRORS',
    title: 'Recent failures',
    prompt: 'Show me failed queries from the last hour',
  },
  {
    category: 'MERGES',
    title: 'Merge queue check',
    prompt:
      'How is the merge queue performing? Are there any large merges stuck?',
  },
  {
    category: 'SYSTEM',
    title: 'Server resources',
    prompt: 'What is the current CPU, memory, and disk usage of this server?',
  },
  {
    category: 'STORAGE',
    title: 'Compression check',
    prompt:
      'Which tables compress the worst, and what would improve their ratio?',
  },
  {
    category: 'QUERIES',
    title: 'Most expensive patterns',
    prompt:
      'Which query patterns consume the most CPU time over the past 7 days?',
  },
  {
    category: 'SCHEMA',
    title: 'Partitioning review',
    prompt: 'Are any tables over-partitioned or creating too many parts?',
  },
  {
    category: 'INSIGHTS',
    title: 'Unused tables',
    prompt:
      'Which tables have not been read from recently but still cost disk?',
  },
  {
    category: 'MERGES',
    title: 'Mutation backlog',
    prompt: 'Are there any long-running or stuck mutations right now?',
  },
  {
    category: 'SYSTEM',
    title: 'Replication lag',
    prompt: 'Is replication healthy, and is any replica falling behind?',
  },
  {
    category: 'ERRORS',
    title: 'Top error types',
    prompt: 'What are the most frequent errors on this cluster and why?',
  },
  {
    category: 'INSIGHTS',
    title: 'Capacity forecast',
    prompt:
      'At the current growth rate, when will this cluster run out of disk?',
  },
] as const

/** Fisher–Yates shuffle, returning a new array (input is left untouched). */
export function shufflePrompts(
  prompts: readonly SuggestedPrompt[]
): SuggestedPrompt[] {
  const out = [...prompts]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
