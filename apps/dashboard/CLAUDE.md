# apps/dashboard — Claude context (app internals)

This is the **primary dashboard app** — a TanStack Start application (React 19 +
Vite + `@cloudflare/vite-plugin`) that replaced the legacy Next.js app in v0.3.
It connects to ClickHouse instances and renders real-time monitoring views.

This file documents the **app-internal layout and patterns**. For repo-wide
conventions (commit style, cloud-vs-OSS mode, deploy, testing, ClickHouse
version compatibility, the knowledge graph), read the **root
[`../../CLAUDE.md`](../../CLAUDE.md)** first, and see **[`../../docs/PRD.md`](../../docs/PRD.md)**
(§10.2) for the product/architecture spec. Package name: `dashboard`; package
manager is `bun`.

## Directory map (`src/`)

```
src/
  router.tsx            TanStack Router instance
  start.ts              TanStack Start server entry
  routes/               file-based routes (see below)
  components/           UI (data-table, charts, host, layout, assistant-ui, …)
  lib/                  data layer, query configs, AI agent, cloud mode, utils
  hooks/                app-level React hooks (use-mobile, use-layout-view)
  db/                   D1 / persistence helpers
  types/                shared types (query-config.ts, charts.ts, column-format.ts, …)
  menu.ts               navigation menu configuration
  styles.css            Tailwind v4 entry
```

### Routes — `src/routes/`

- **Dashboard pages** live under `src/routes/(dashboard)/` as file-based routes
  (e.g. `merges.tsx`, `overview.tsx`, `mutations.tsx`, plus nested groups like
  `queries/`, `keeper/`, `logs/`, `clusters/`). There are 60+ page routes.
- **API routes** live under `src/routes/api/` (`health.ts`, `mcp.ts`,
  `version.ts`, `cron/`, `v1/`, …).
- `__root.tsx`, `index.tsx`, `sign-in.tsx`, `sign-up.tsx`, and `healthz.ts` sit
  at the routes root.
- **Multi-host routing** uses the `?host=0` query param (index into the
  comma-separated `CLICKHOUSE_*` env lists).

Most monitoring pages are thin: they import a `QueryConfig` and hand it to a
shared `PageLayout` (`components/layout/query-page/`), wrapped in `<Suspense>`
with a `PageSkeleton`. Example (`routes/(dashboard)/merges.tsx`):

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { mergesConfig } from '@/lib/query-config/merges/merges'

function MergesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageLayout queryConfig={mergesConfig} />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/merges')({
  component: MergesPage,
  head: () => pageOgHead('merges'),
})
```

### Data layer — `src/lib/`

- **`lib/clickhouse-helpers.ts`** — `fetchDataWithHost(...)` is the app entry
  point for running a query. It validates/normalizes `hostId` and delegates to
  `fetchData` from the workspace client `@chm/clickhouse-client`. **`hostId` is
  required** for any query (defaults to host `0`); never drop it.
- **`lib/clickhouse-query.ts`** — query-building helpers (`buildTimeFilter`,
  `applyInterval`, `withQueryParams`, `fillStep`, …).
- **Client hooks** — server-state is fetched with TanStack Query hooks:
  - `lib/swr/` — host/config/data hooks (`use-hosts`, `use-host`,
    `use-host-status`, `use-merged-hosts`, `api-fetch`, `host-context`, …).
    `use-merged-hosts.ts` implements cloud demo-host tagging (see root CLAUDE.md
    "cloud mode").
  - `lib/hooks/` — feature hooks (agent, MCP config, user connections, settings,
    performance, keyboard shortcut, …).
- **`lib/table-validator.ts` + `lib/table-existence-cache.ts`** — guard optional
  system tables (`system.backup_log`, `system.error_log`, `system.zookeeper`, …)
  via `optional: true` / `tableCheck` on a `QueryConfig`.

### Query configs — `src/lib/query-config/`

Each data view is a `QueryConfig` (type in **`src/types/query-config.ts`**;
runtime types re-exported from `lib/query-config/types.ts`). Configs are grouped
by domain (`merges/`, `queries/`, `tables/`, `system/`, `logs/`, `keeper/`,
`security/`, `explorer/`, `anomaly/`, `more/`, plus a `declarative/` catalog) and
registered centrally in **`lib/query-config/index.ts`**. A config carries the
SQL (a string or a versioned `{ since, sql }[]` array — see the root CLAUDE.md
ClickHouse-version section), column formatting, sorting/filtering, and row
actions.

### Components — `src/components/`

- **`components/data-table/`** — the table system: `column-defs/`, `cells/`,
  `formatters/`, `sorting-fns.ts`, filters, pagination, row-expand, toolbar.
  Synthetic column ids `__expand`, `select`, `action` are non-data columns.
- **`components/charts/`** — chart system. `chart-container.tsx`,
  `chart-card-styles.ts`, `chart-error.tsx`, `chart-stale-indicator.tsx`,
  `chart-registry.tsx`, plus per-domain chart folders (`merge/`, `query/`,
  `logs/`, `query-performance/`, `primitives/`, `factory/`). Follow the
  graceful-error / stale-indicator pattern documented in the root CLAUDE.md.
- **`components/host/`** — host switcher and first-run/welcome state
  (`host-switcher.tsx`, `first-run-empty-state.tsx`).
- **`components/assistant-ui/`** — the AI chat thread UI (message stats footer,
  dialogs).
- Base shadcn/ui primitives are in **`components/ui/`** — **never edit these
  directly** (see root CLAUDE.md); style at the usage site or via a wrapper.

### AI agent — `src/lib/ai/agent/`

Built on the **Vercel AI SDK** (not LangGraph). `clickhouse-agent.ts` is the
runner; prompts in `prompts/`; the skill registry/loader in `skills/` (the
skills themselves live at repo-root `.agents/skills/`); MCP glue in `mcp/`.

Tools are assembled by **`tools/index.ts`** (`createAllTools`). It composes 13
tool modules exposing ~25 tools total (22 by default; the 3 destructive
`control-tools` are gated off unless `AGENT_ENABLE_CONTROL_TOOLS=true`):

| Module | Tools |
|--------|-------|
| `schema-tools` | `query`, `list_databases`, `list_tables`, `get_table_schema`, `explore_table_schema` |
| `query-tools` | `get_running_queries`, `get_slow_queries`, `get_failed_queries`, `explain_query` |
| `health-tools` | `get_metrics`, `get_disk_usage` |
| `storage-tools` | `get_table_parts`, `forecast_disk_capacity`, `suggest_ttl_adjustment` |
| `replication-tools` | `get_replication_status` |
| `merge-tools` | `get_merge_status` |
| `plan-tools` | `update_plan` |
| `skill-tools` | `load_skill` |
| `ask-user-tools` | `ask_user` |
| `visualization-tools` | `query_and_visualize` |
| `insight-tools` | `explain_anomaly_score` |
| `advisor-tools` | `get_optimization_recommendations` |
| `control-tools` (gated) | `kill_query`, `optimize_table`, `kill_mutation` |

`helpers.ts` and `sql-analysis.ts` are shared helpers, not tool modules. The
design is a deliberately lean set of primitives — anything not covered is done
with the `query` tool plus a `load_skill` recipe. **Keep the user-facing docs at
`../../docs/content/guide/ai-agent.mdx` in sync** whenever you add/rename/remove
a tool, skill, or agent env var.

## How to add …

### … a dashboard route
1. Add `src/routes/(dashboard)/<name>.tsx` exporting a `Route` via
   `createFileRoute('/(dashboard)/<name>')`.
2. For a standard table view, create/point to a `QueryConfig` and render
   `<PageLayout queryConfig={...} />` inside `<Suspense fallback={<PageSkeleton />}>`.
3. Add an OG head with `pageOgHead('<name>')` and wire navigation in `src/menu.ts`.

### … a query config
1. Add the config under the matching `src/lib/query-config/<domain>/` folder,
   typed as `QueryConfig` (from `@/types/query-config`).
2. Use a versioned `sql: [{ since, sql }]` array if columns differ across
   ClickHouse versions; mark `optional: true` + `tableCheck` for optional tables.
3. Register/export it via `lib/query-config/index.ts` and reference it from the
   route.

### … a chart
1. Add the chart component under `src/components/charts/` (or a domain
   subfolder), consuming data via a TanStack Query hook.
2. Use `ChartContainer` / `ChartCard` and the graceful-error + stale-indicator
   pattern (`useChartData` → `staleError` / `hasData`); register it where the
   page's chart strip is assembled.

### … an agent tool
1. Add or extend a module in `src/lib/ai/agent/tools/` returning a
   `dynamicTool({...})` map, and wire it into `tools/index.ts`.
2. Update `../../docs/content/guide/ai-agent.mdx` in the same change.

## Verification

Run `bun run build` (Vite build + `tsc --noEmit`) after changes; `bun run lint`
for Biome. See the root CLAUDE.md for the full test/deploy commands.
