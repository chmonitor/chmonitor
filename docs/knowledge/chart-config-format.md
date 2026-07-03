---
id: chart-config-format
title: Declarative Chart Config Format
type: spec
status: active
updated: 2026-07-04
tags:
  - charts
  - declarative
  - catalog
  - platform
related:
  - query-config-format
  - declarative-config-catalog
  - static-site-architecture
  - product-design
---

# Declarative Chart Config Format

The **declarative chart catalog** is the serializable subset of a factory
chart's config expressed as plain data — objects with no JSX, no functions,
and no live component imports. It mirrors the
[[declarative-config-catalog|declarative QueryConfig catalog]] (plans 53-54),
but for charts (plans/58-declarative-chart-schema.md): the goal is the same —
let the community (or an AI agent) author a monitoring chart without writing
TypeScript.

## Specification

Roughly 40 of chmonitor's ~74 charts are built via one of two "pure" chart
factories — `createAreaChart` / `createBarChart`
(`apps/dashboard/src/components/charts/factory/`) — that take a config object
and return a fully-wired `FC<ChartProps>` (title, SQL toolbar, date range,
loading/error/empty states all handled by `ChartCard`/`ChartContainer`). A
declarative chart definition is a data description of **that exact config
object** — `DeclarativeChart` is a discriminated union on `type`:

```typescript
type DeclarativeChart =
  | { type: 'area'; chartName; index; categories; areaChartProps?; ... }
  | { type: 'bar'; chartName; index; categories; barChartProps?; ... }
```

`chartName` is not a chart's own SQL — it's the key the chart is *fetched*
under, `GET /api/v1/charts/$chartName`, which must already be registered in
the server-side `lib/api/chart-registry.ts`. The declarative schema describes
**presentation only** (which factory, which columns, axis/legend/color
options), not the ClickHouse query behind it — that stays a normal
chart-registry builder either way.

The third factory, `createCustomChart` (bespoke `render(data) => ReactNode`
charts — progress bars, proportion lists, metric tiles, …), is **not**
declarative-capable: `render` is a function reference, not serializable.
Charts that need that level of bespoke layout stay TS-only.

## Where it lives

```
apps/dashboard/src/components/charts/declarative/
├── schema.ts        # Zod schema — the catalog contract (DeclarativeChart)
├── validate.ts       # validateDeclarativeChart() → {ok, chart|errors}
├── loader.ts          # loadDeclarativeChart() → {kind, config}; createChartFromDeclarative()
├── icon.tsx            # lazy lucide-react icon resolution (ChartIcon, isKnownChartIconName)
└── catalog/
    ├── index.ts        # DECLARATIVE_CHART_CATALOG: Record<chartName, DeclarativeChart>
    └── <domain>/*.ts    # one file per ported chart, grouped by domain
```

## Pipeline

```
DeclarativeChart (data)
  → validateDeclarativeChart (Zod)      # throws/returns errors on bad input
  → loadDeclarativeChart                # maps serializable fields 1:1 to *ChartFactoryConfig
  → { kind: 'area'|'bar', config }      # the exact AreaChartFactoryConfig / BarChartFactoryConfig
  → createChartFromDeclarative          # calls createAreaChart(config) / createBarChart(config)
  → FC<ChartProps>                       # same rendering path as a hand-authored chart
```

There is no parallel rendering pipeline — `createChartFromDeclarative` calls
the SAME `createAreaChart`/`createBarChart` a hand-authored `.tsx` chart file
calls. A declarative chart and its hand-authored twin produce byte-identical
factory config objects (enforced by the parity tests below), so they render
identically.

## What the schema can express

Shared (`BaseChartFactoryConfig` subset): `chartName`, `description` (catalog
metadata), `icon` (catalog metadata, see below), `defaultTitle`,
`defaultInterval` (`ClickHouseInterval`), `defaultLastHours`,
`refreshInterval`, `dataTestId`, `dateRangeConfig` (a `DateRangePresetName`
string — `'realtime' | 'query-activity' | 'system-metrics' | ...`; a bespoke
`DateRangeConfig` options array is not serializable and stays TS-only),
`enableScaleToggle`.

- **`type: 'area'`** adds `index`, `categories: string[]`,
  `defaultChartClassName`, `showDeployments` (GitHub deploy-marker overlay),
  and `areaChartProps` — a serializable subset of `AreaChartProps`: `colors`,
  `stack`, `relative`, `opacity`, `breakdown`/`breakdownLabel`/`breakdownValue`,
  `showLegend`/`showXAxis`/`showYAxis`/`showTooltip`/`showCartesianGrid`,
  `readable` (`'bytes'|'duration'|'number'|'quantity'`), `readableColumn(s)`,
  `yAxisScale`, plus `yAxisTickFormatterKey` (see below).
- **`type: 'bar'`** adds `index`, `categories: string[]` (the TS
  `(data) => string[]` function form is not serializable — declarative bar
  charts require a static category list), `defaultChartClassName`,
  `xAxisDateFormat`, and `barChartProps` (`colors`, `stack`, `layout`,
  `barCategoryGap`, `readableColumn`, `tooltipTotal`, `yAxisScale`,
  `showLegend`/`showXAxis`/`showYAxis`/`showTooltip`, plus
  `yAxisTickFormatterKey`).

### yAxisTickFormatterKey — the tickFormatter replacement

`AreaChartProps`/`BarChartProps.yAxisTickFormatter` is a function, so it isn't
serializable directly. `yAxisTickFormatterKey` is a named reference into
`lib/utils.ts#chartTickFormatters` (`'bytes' | 'percentage' | 'count' |
'duration' | 'default'`); the loader resolves it to the matching function and
sets it on `areaChartProps.yAxisTickFormatter` /
`barChartProps.yAxisTickFormatter` — covering the common case without
smuggling a function into the catalog.

### icon — lazy lucide-react resolution

`icon` is a plain lucide-react icon name string (kebab-case, e.g. `'cpu'`,
`'memory-stick'`, `'database'`) — catalog metadata for a future chart-picker /
docs surface, not consumed by the factories today (they have no icon prop).
Validated at schema time against lucide-react's own icon-name list (a typo
fails catalog validation, not a silent blank icon). Resolution goes through
`lucide-react/dynamic`'s `DynamicIcon` + `dynamicIconImports` — lucide-react's
own lazy-icon mechanism, which code-splits each icon behind its own
`import()`. `icon.tsx` does **not** eagerly import the full lucide-react icon
set; only an icon a `ChartIcon` actually renders is ever fetched.

## What stays TS-only (and why)

- **`createCustomChart` / `render`** — a function reference; any chart needing
  bespoke JSX (progress bars, proportion lists, metric tiles) stays TS-only.
- **`categories` as a function** (`BarChartFactoryConfig`'s
  `(data) => string[]` form) — declarative bar charts require a static list.
- **`tickFormatter` / `valueFormatter` / `customTooltip` / `onValueChange` /
  `chartConfig`** — function/JSX-valued props on `AreaChartProps`/
  `BarChartProps`. `yAxisTickFormatterKey` covers the common tick-formatting
  case; anything more custom stays TS-only.
- **A literal `DateRangeConfig` options array** — only the named presets
  (`DateRangePresetName`) are declarative; a bespoke option set is TS-only.

## Testing

Each domain has a `<domain>-catalog.test.ts` parity suite
(`catalog/query/query-catalog.test.ts`, `catalog/system/system-catalog.test.ts`,
…) that runs `loadDeclarativeChart(decl).config` and **deep-equals** the result
against the exact config object literal the hand-authored TS chart passes to
`createAreaChart`/`createBarChart` — the same parity philosophy as the
query-config catalog's `merges-catalog.test.ts`, with one difference worth
being explicit about: the query-config version imports the *real* legacy
config object and diffs against it, while the chart version diffs against a
**transcription** of the hand-authored factory call (chart files export only
the rendered `FC`, not their config object — exporting it would mean editing
the "untouched" source file). A transcription can't catch a copy mistake or
future drift in the original by itself, so `catalog/catalog.test.ts` adds one
check against a live source of truth instead of a transcription: an orphan
guard (mirroring `flip-safety.test.ts`'s) that asserts every catalog
`chartName` resolves via `hasChart()` in the real
`lib/api/chart-registry.ts` — catching a typo that would otherwise 404 silently
at `GET /api/v1/charts/$chartName` instead of failing a test.
`catalog/catalog.test.ts` also asserts the catalog has no duplicate
`chartName`s and that every entry loads without throwing.
`schema.test.ts` / `loader.test.ts` / `icon.test.ts` cover schema validation
and the loader's field mapping (including `yAxisTickFormatterKey` resolution)
directly.

## Status

Dormant by design — nothing in the live app (routes, `chart-registry`,
`components/charts/registry/`) consumes `DECLARATIVE_CHART_CATALOG` yet; every
hand-authored TS chart file keeps rendering exactly as before (additive only,
no cutover). 6 charts are ported as templates across 4 domains: `query-count` /
`query-duration` (area, `query/`), `memory-usage` / `cpu-usage` (area,
`system/`), `error-rate-over-time` (area, multi-category + legend, `logs/`),
`zookeeper-requests` (bar, `zookeeper/`) — covering both factory types and the
common config shapes (breakdown, stack, multi-series, tick formatting).
Whether/how declarative charts eventually join the chart registry or a
dashboard-builder chart picker (plan 57) is an open question left for that
follow-up plan; this catalog is the loader + template proof it would build on.

## Key Files

- `apps/dashboard/src/components/charts/declarative/schema.ts` — type definitions (Zod)
- `apps/dashboard/src/components/charts/declarative/loader.ts` — declarative → factory config
- `apps/dashboard/src/components/charts/declarative/catalog/` — ported chart templates
- `apps/dashboard/src/components/charts/factory/` — the two pure factories this loader targets
- `apps/dashboard/src/lib/api/chart-registry.ts` — the `chartName` → SQL registry declarative charts reference

## See Also

- [[query-config-format]] — the analogous format for table/query views
- [[declarative-config-catalog]] — the query-config declarative system this mirrors
- [[product-design]] — chart design tokens/conventions a new chart should follow
