---
id: traffic-insights
title: Traffic / ingestion page — builders, smart detection, measurement model
type: spec
status: active
updated: 2026-07-16
tags:
  - traffic
  - ingestion
  - charts
  - part_log
  - query_log
  - compression
  - peerdb
  - smart-detection
related:
  - chart-config-format
  - query-config-format
  - postgres-source
  - conventions
---

# Traffic / ingestion page

The `/traffic` dashboard page answers one question: **how much data is flowing
into this cluster?** It layers last-24h ingestion KPIs, rows/bytes/insert-query
time series, per-table ingestion, and — only when the cluster actually
replicates, shards, or runs PeerDB — the matching write-amplification and
data-movement views.

- **Route:** `apps/dashboard/src/routes/(dashboard)/traffic.tsx`
- **Chart builders:** `apps/dashboard/src/lib/api/charts/traffic-charts.ts`
- **Per-table table:** `apps/dashboard/src/lib/query-config/traffic/per-table-ingestion.ts`
- **Menu:** `Traffic` in `section: 'main'` (`src/menu.ts`), `permission: { feature: 'metrics' }`, `tableCheck: 'system.query_log'`, `isNew: true`.
- **User docs:** [docs/content/guide/features/traffic.mdx](../content/guide/features/traffic.mdx) (registered in `features.mdx` cards + feature-index table).

## The builder module (`traffic-charts.ts`)

`trafficCharts` is a `Record<string, ChartQueryBuilder>` — the same declarative
chart-builder shape used elsewhere (see [chart-config-format](chart-config-format.md)).
Each entry is a function `({ interval, lastHours }) => { query, optional?, tableCheck? }`,
using the shared `applyInterval` / `buildTimeFilter` / `fillStep` / `nowOrToday`
helpers from `./types`. Hour/day/month granularity comes from each chart's
date-range selector feeding `interval` + `lastHours`.

Builders (some are added by later PRs; document all):

| Key | Measures | Source | `tableCheck` |
|---|---|---|---|
| `traffic-summary` | 24h vs prev-24h rows/bytes/inserts + deltas (KPI strip) | `query_log` | `system.query_log` |
| `traffic-compression` | Overall compression ratio across active parts | `parts` | — (always present) |
| `traffic-inserted-rows` | Rows ingested over time (uncompressed) | `query_log` | `system.query_log` |
| `traffic-inserted-bytes` | Uncompressed bytes ingested over time | `query_log` | `system.query_log` |
| `traffic-bytes-on-disk` | Compressed on-disk size of new parts | `part_log` (`NewPart`) | `system.part_log` |
| `traffic-insert-queries` | Insert-query count incl. **failed** (`ExceptionBeforeStart` / `ExceptionWhileProcessing`) | `query_log` | `system.query_log` |
| `traffic-merged-bytes` | Bytes rewritten by merges | `part_log` (`MergeParts`) | `system.part_log` |
| `traffic-part-moves` | Bytes moved between disks/volumes | `part_log` (`MovePart`) | `system.part_log` |
| `traffic-write-amplification` | Bytes rewritten per byte ingested | `part_log` (`MergeParts`/`MovePart`) | `system.part_log` |
| `traffic-cluster-shape` | Probe: does the cluster replicate/shard? (gates the Replication section) | `replicas` / `clusters` | — |
| `traffic-replica-fetches` | Bytes fetched between replicas | `part_log` (`DownloadPart`) | `system.part_log` |
| `traffic-distributed-queries` | Initial vs secondary query volume | `query_log` | `system.query_log` |
| `traffic-peerdb-detect` | Probe: is PeerDB writing here? (gates the PeerDB section) | derived | — |
| `traffic-peerdb-rows` | Rows ingested through the PeerDB pipeline | derived | — |

The per-table view (`trafficPerTableConfig`) is a normal `QueryConfig`
(`optional: true`, `tableCheck: 'system.part_log'`): it groups `part_log`
`NewPart` over 24h, `LEFT JOIN`s `system.parts` for each table's live
compression, and renders rows/bytes/parts as `BackgroundBar` columns (base +
`readable_*` + `pct_*`, per the query-config convention).

## Measurement model: compressed vs uncompressed

The single most important thing to preserve when editing Traffic: the two data
sources measure **different bytes**, and the page keeps them separate on
purpose.

- **`system.query_log`** — `written_rows` / `written_bytes` on
  `type = 'QueryFinish' AND query_kind = 'Insert'` = the **UNCOMPRESSED** payload
  as ingested. "How much data clients sent us." Always available.
- **`system.part_log`** — `size_in_bytes` on `event_type = 'NewPart'` = the
  **ON-DISK (compressed)** size of each new part. "How much we actually stored."
  Opt-in.
- **`system.parts`** (active) — `data_uncompressed_bytes` /
  `data_compressed_bytes` give the *current* overall compression ratio
  (uncompressed ÷ compressed).

`traffic-inserted-bytes` (uncompressed) vs `traffic-bytes-on-disk` (compressed)
are meant to be read **against each other** — that ratio over time is the
effective compression of incoming data. Do not "simplify" one of them onto the
other table; you would collapse two distinct measurements into one.

## Smart-detection pattern

Two page sections are **conditional and self-hiding** — they never render empty
cards on clusters where they are meaningless:

1. **Cluster-shape probe** (`traffic-cluster-shape`) inspects `system.replicas` /
   `system.clusters` to decide whether the cluster replicates or shards. Only
   then does the **Replication & Distribution** section (replica fetches,
   distributed queries) render.
2. **PeerDB probe** (`traffic-peerdb-detect`) checks for PeerDB write activity;
   only then does the **PeerDB Ingestion** section render.

The client pattern is **"section-returns-null"**: the section component runs its
detection query and returns `null` when detection is negative, so the layout
collapses rather than showing disabled/empty cards. This is distinct from the
`optional`/`tableCheck` degradation used for `part_log`-backed charts — that one
still renders the card with an informative empty state; the smart-detection
sections omit the card entirely.

### PeerDB detection heuristics

PeerDB detection is activity-based (not config-based): it looks for the
fingerprint of a PeerDB mirror writing into this ClickHouse (PeerDB-managed
target tables / rows written through the pipeline). It is independent of the
env-configured `PEERDB_API_URL` used by the dedicated
[PeerDB feature](postgres-source.md) pages — Traffic can surface PeerDB
ingestion even when the PeerDB API integration is not wired, because it reads
the ClickHouse side directly.

## Graceful degradation (`part_log` opt-in)

`system.part_log` is off by default on some distributions. Every `part_log`
builder carries `optional: true` + `tableCheck: 'system.part_log'`, so the
table-validator (`lib/table-validator.ts` + `lib/table-existence-cache.ts`)
short-circuits to an informative empty state instead of erroring. The KPI strip,
the two query_log charts, and the overall compression ratio keep working with
only `query_log` + `parts` (both on by default). Enabling `part_log` (a
`<part_log>` server-config block) lights up Bytes-on-disk, Merges & Data
Movement, Top Tables, and Replica fetches.

## Extending the page

To add a new Traffic section/chart:

1. **New builder** — add a keyed function to `trafficCharts` in
   `traffic-charts.ts`. Reuse `applyInterval` / `buildTimeFilter` / `fillStep` /
   `nowOrToday`. If it reads `part_log` (or any non-default table), set
   `optional: true` + the correct `tableCheck` so it degrades gracefully.
2. **Preserve the measurement model** — decide up front whether you are
   measuring uncompressed ingest (`query_log`) or on-disk bytes (`part_log`) and
   name the columns accordingly (`*_bytes` vs `*_on_disk`).
3. **Conditional section?** — if it is only meaningful on some clusters, add a
   detection probe builder and make the section component **return `null`** when
   the probe is negative (smart-detection pattern above); do not render an empty
   card.
4. **Per-table table** — extend `trafficPerTableConfig` (`query-config/traffic/`)
   following the `BackgroundBar` triple-column convention (base + `readable_*` +
   `pct_*`).
5. **Wire it** into `traffic.tsx` (KPI strip / ingestion grid / a section) and
   keep the user docs
   [docs/content/guide/features/traffic.mdx](../content/guide/features/traffic.mdx)
   in sync in the same change.
