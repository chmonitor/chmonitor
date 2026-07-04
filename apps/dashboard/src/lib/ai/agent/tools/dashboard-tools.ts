/**
 * AI-generated dashboards (plan 59).
 *
 * `suggest_dashboard` maps a natural-language request ("show me everything
 * about replication health") to a `DashboardLayout` (plan 57's grid contract)
 * built ONLY from charts that exist in BOTH chart registries:
 *   - `components/charts/registry` (the client-side lazy React component a
 *     `type: 'chart'` widget actually renders — see `widget-chart.tsx`).
 *   - `lib/api/chart-registry` (the server-side SQL builder the chart's data
 *     fetch resolves against).
 * A chart missing from either layer would render as "Chart not found" or
 * 404 its data fetch, so both are required — mirroring the cross-layer
 * parity check in `lib/api/__tests__/registry-completeness.test.ts`.
 *
 * Deliberately recommend-only, mirroring `mv-designer-tools.ts` /
 * `advisor-tools.ts`: this tool NEVER writes to dashboard storage. It returns
 * a `dashboard_suggestion` payload that the chat UI renders with an explicit
 * "Apply to dashboard" action (`agent-dashboard-suggestion.tsx`) — clicking it
 * is the only thing that loads the layout into the dashboard's working grid,
 * and saving still requires the existing `SavedDashboardsToolbar` save action.
 * This is the "AI proposes, user confirms" shape used elsewhere in the agent
 * (`update_plan` emits a plan the UI renders; nothing here calls
 * `saveDashboard()` from inside a tool `execute()`).
 *
 * AI usage is metered the same way every other tool call is: `incrementAiUsage`
 * runs once per agent turn in the agent route's plan-enforcement gate,
 * independent of which tools that turn used — see
 * lib/billing/ai-usage-store.ts. No additional metering is needed here.
 *
 * The ranking heuristic is a small, deterministic keyword/synonym match over
 * chart names + curated categories (`CHARTS_BY_CATEGORY`) — no LLM call and
 * no arbitrary code, so a request can never surface a chart outside the
 * registry (see `isKnownChart`).
 */

import { z } from 'zod'

import { dynamicTool } from 'ai'
import {
  CHARTS_BY_CATEGORY,
  getRegisteredChartNames,
  hasChart as hasChartComponent,
} from '@/components/charts/registry'
import { hasChart as hasChartQuery } from '@/lib/api/chart-registry'
import {
  type DashboardLayout,
  type DashboardWidget,
  DEFAULT_CHART_WIDGET_H,
  DEFAULT_CHART_WIDGET_W,
  findFreePosition,
} from '@/types/dashboard-layout'

const MIN_WIDGETS = 1
const MAX_WIDGETS = 10
const DEFAULT_WIDGET_COUNT = 6
const MAX_REQUEST_LEN = 280

/** A fallback set of broadly-useful charts, used to top up a vague request so a suggestion is never empty. */
const FALLBACK_CHARTS = [
  'query-count',
  'query-duration',
  'memory-usage',
  'cpu-usage',
  'disk-size',
  'merge-count',
] as const

/** Domain-vocabulary bridge between NL requests and chart-name tokens. */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  replication: ['replica', 'replicas', 'replicated'],
  replica: ['replication'],
  keeper: ['zookeeper', 'zk'],
  zookeeper: ['keeper', 'zk'],
  merge: ['merges', 'merging', 'mutation', 'mutations'],
  merges: ['merge', 'mutation', 'mutations'],
  mutation: ['merge', 'merges'],
  memory: ['ram', 'mem'],
  disk: ['storage', 'space'],
  cpu: ['processor', 'compute'],
  slow: ['latency', 'duration', 'performance'],
  performance: ['slow', 'latency', 'duration'],
  failed: ['error', 'errors', 'failure', 'failures'],
  error: ['failed', 'errors', 'failure'],
  connection: ['connections', 'clients', 'client'],
  cache: ['caching', 'cached'],
  security: ['auth', 'login', 'access'],
  health: ['status', 'overview'],
  backup: ['backups'],
  table: ['tables'],
  query: ['queries'],
}

/** True if `chartName` is safe to reference in a widget — present in BOTH registries. */
export function isKnownChart(chartName: string): boolean {
  return hasChartComponent(chartName) && hasChartQuery(chartName)
}

/** Reverse `CHARTS_BY_CATEGORY` into chart name → category, for scoring. */
function buildCategoryLookup(): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const [category, names] of Object.entries(CHARTS_BY_CATEGORY)) {
    for (const name of names) lookup.set(name, category)
  }
  return lookup
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
}

function expandWithSynonyms(words: string[]): Set<string> {
  const expanded = new Set(words)
  for (const word of words) {
    for (const synonym of KEYWORD_SYNONYMS[word] ?? []) expanded.add(synonym)
  }
  return expanded
}

/** All chart names present in BOTH registries — the only valid candidates. */
function candidateChartNames(): string[] {
  return getRegisteredChartNames().filter((name) => hasChartQuery(name))
}

/**
 * Score a chart candidate against the expanded request keyword set. Exact
 * token matches score higher than plain substring matches so e.g. "merge"
 * outranks a coincidental partial hit.
 */
function scoreChart(
  chartName: string,
  category: string | undefined,
  requestWords: Set<string>
): number {
  const nameTokens = new Set(chartName.split('-').filter(Boolean))
  const haystack = `${chartName.replace(/-/g, ' ')} ${category ?? ''}`

  let score = 0
  for (const word of requestWords) {
    if (nameTokens.has(word)) score += 2
    else if (haystack.includes(word)) score += 1
  }
  return score
}

export interface DashboardSuggestionChart {
  chartName: string
  score: number
}

export interface DashboardSuggestion {
  type: 'dashboard_suggestion'
  request: string
  name: string
  layout: DashboardLayout
  chartCount: number
}

/**
 * Pure suggestion builder — no I/O, deterministic given the same registries.
 * Exported for golden-style unit tests.
 */
export function buildDashboardSuggestion(
  request: string,
  options: { maxWidgets?: number; name?: string } = {}
): DashboardSuggestion {
  const maxWidgets = Math.min(
    MAX_WIDGETS,
    Math.max(
      MIN_WIDGETS,
      Math.trunc(options.maxWidgets ?? DEFAULT_WIDGET_COUNT)
    )
  )

  const categoryLookup = buildCategoryLookup()
  const requestWords = expandWithSynonyms(tokenize(request))
  const candidates = candidateChartNames()

  const ranked: DashboardSuggestionChart[] = candidates
    .map((chartName) => ({
      chartName,
      score: scoreChart(chartName, categoryLookup.get(chartName), requestWords),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)

  const selected: DashboardSuggestionChart[] = ranked.slice(0, maxWidgets)

  // Top up with fallback charts (never repeating an already-selected one) so
  // a vague or unmatched request still yields a useful, non-empty dashboard.
  if (selected.length < maxWidgets) {
    const selectedNames = new Set(selected.map((c) => c.chartName))
    for (const chartName of FALLBACK_CHARTS) {
      if (selected.length >= maxWidgets) break
      if (selectedNames.has(chartName)) continue
      if (!isKnownChart(chartName)) continue
      selected.push({ chartName, score: 0 })
      selectedNames.add(chartName)
    }
  }

  const widgets: DashboardWidget[] = []
  for (const { chartName } of selected) {
    const { x, y } = findFreePosition(
      widgets,
      DEFAULT_CHART_WIDGET_W,
      DEFAULT_CHART_WIDGET_H
    )
    widgets.push({
      id: crypto.randomUUID(),
      type: 'chart',
      chartName,
      x,
      y,
      w: DEFAULT_CHART_WIDGET_W,
      h: DEFAULT_CHART_WIDGET_H,
    })
  }

  const name =
    options.name?.trim() ||
    request.trim().slice(0, 60) ||
    'AI-suggested dashboard'

  return {
    type: 'dashboard_suggestion',
    request,
    name,
    layout: { widgets },
    chartCount: widgets.length,
  }
}

export function createDashboardTools() {
  return {
    suggest_dashboard: dynamicTool({
      description:
        'Suggest a dashboard layout built ONLY from existing registry charts for a natural-language request (e.g. "show me everything about replication health"). Returns a proposed set of chart widgets on the plan-57 grid layout. Recommend-only — never persisted; the UI shows an \'Apply to dashboard\' action the user must click to load it into the dashboard builder, and the user still has to save it explicitly afterwards.',
      inputSchema: z.object({
        request: z
          .string()
          .min(1)
          .max(MAX_REQUEST_LEN)
          .describe(
            'Natural-language description of what the dashboard should show'
          ),
        maxWidgets: z
          .number()
          .int()
          .min(MIN_WIDGETS)
          .max(MAX_WIDGETS)
          .optional()
          .describe(
            `Max number of chart widgets to include (default ${DEFAULT_WIDGET_COUNT}, max ${MAX_WIDGETS})`
          ),
        name: z
          .string()
          .max(120)
          .optional()
          .describe('Suggested dashboard name (defaults to the request text)'),
      }),
      execute: async (input: unknown): Promise<DashboardSuggestion> => {
        const { request, maxWidgets, name } = input as {
          request: string
          maxWidgets?: number
          name?: string
        }
        return buildDashboardSuggestion(request, { maxWidgets, name })
      },
    }),
  }
}
