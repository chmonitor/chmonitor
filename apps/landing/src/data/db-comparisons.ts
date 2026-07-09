/**
 * Row data for the /clickhouse-vs-* near-ICP database comparison pages
 * (`DbComparisonTable.astro`) — plans/05-implementation-tasks.md S4.
 *
 * Unlike `comparisons.ts` (chmonitor vs a monitoring tool), these compare the
 * underlying databases themselves. Every row is sourced from each project's
 * public docs as of July 2026 (see each page's `note` slot for links) and
 * deliberately includes rows where the other database wins — no strawmen.
 */
import type { DbComparisonRow } from '../components/DbComparisonTable.astro'

export const timescaledbRows: DbComparisonRow[] = [
  {
    label: 'Core storage model',
    cells: [
      {
        kind: 'plain',
        text: 'Purpose-built columnar (MergeTree): every column stored and compressed separately, built for scanning wide analytical queries',
      },
      {
        kind: 'plain',
        text: 'A PostgreSQL extension: hypertables auto-partition by time; Hypercore (2.18+) adds a columnar store for cold chunks on top of the Postgres row-store',
      },
    ],
  },
  {
    label: 'SQL dialect & ecosystem',
    cells: [
      {
        kind: 'plain',
        text: 'ClickHouse SQL: broad standard SQL plus CH-specific functions and table engines; the driver/ORM ecosystem is younger',
      },
      {
        kind: 'plain',
        text: 'Full PostgreSQL SQL and ecosystem — any Postgres driver, ORM, or extension (PostGIS, pgvector) works unmodified',
      },
    ],
  },
  {
    label: 'ACID transactions & joins',
    cells: [
      {
        kind: 'partial',
        text: 'No multi-statement transactions; join support has improved a lot but denormalizing wide tables is still the idiomatic pattern at scale',
      },
      {
        kind: 'yes',
        text: "Full Postgres ACID transactions and a mature relational join planner, inherited unchanged",
      },
    ],
  },
  {
    label: 'High-cardinality aggregation at scale',
    cells: [
      {
        kind: 'yes',
        text: 'Vectorized columnar execution scans billions of rows per second on modest hardware — the core design goal',
      },
      {
        kind: 'partial',
        text: 'Hypercore compression narrows the gap on cold data, but row-store execution still trails on wide ad hoc GROUP BY scans over hot data',
      },
    ],
  },
  {
    label: 'Write pattern',
    cells: [
      {
        kind: 'partial',
        text: 'Optimized for large batch inserts; frequent tiny inserts create excess parts that need background merging',
      },
      {
        kind: 'yes',
        text: "Handles continuous small writes gracefully via Postgres MVCC — the common time-series/IoT ingestion pattern",
      },
    ],
  },
  {
    label: 'Continuous / materialized aggregation',
    cells: [
      {
        kind: 'yes',
        text: 'Materialized views and projections, insert-triggered, ship in every edition',
      },
      {
        kind: 'partial',
        text: 'Continuous aggregates (self-refreshing materialized views) are a first-class feature, but ship under the Timescale License, not the Apache 2.0 core',
      },
    ],
  },
  {
    label: 'Horizontal / distributed scale',
    cells: [
      {
        kind: 'yes',
        text: 'Native sharding and replication across many nodes is a hallmark use case, from a single node to petabyte-scale clusters',
      },
      {
        kind: 'no',
        text: 'Multi-node distributed hypertables were sunset in v2.13; scaling is single-node (Hypercore) plus Timescale Cloud for managed scale-out',
      },
    ],
  },
  {
    label: 'Operational surface',
    cells: [
      {
        kind: 'partial',
        text: 'One extra moving part: ClickHouse Keeper (or ZooKeeper) coordinates replication and merges',
      },
      {
        kind: 'yes',
        text: "It's Postgres — one familiar system, one set of ops runbooks, one skillset to hire for",
      },
    ],
  },
  {
    label: 'Licensing',
    cells: [
      { kind: 'plain', text: 'Apache 2.0, fully open source' },
      {
        kind: 'plain',
        text: 'Core is Apache 2.0; compression, continuous aggregates, retention policies and bloom indexes ship under the source-available Timescale License (free unless resold as a hosted DBaaS)',
      },
    ],
  },
  {
    label: 'Best fit',
    cells: [
      {
        kind: 'plain',
        text: 'Ad hoc analytics over huge, high-cardinality datasets: event/log analytics, real-time dashboards, wide GROUP BY across billions of rows',
      },
      {
        kind: 'plain',
        text: 'Time-series metrics with standard relational needs: IoT/financial data, complex joins, ACID guarantees, one Postgres skillset for OLTP and time-series',
      },
    ],
  },
]

export const postgresRows: DbComparisonRow[] = [
  {
    label: 'Storage model',
    cells: [
      { kind: 'plain', text: 'Column-oriented (MergeTree): each column stored and compressed contiguously' },
      { kind: 'plain', text: 'Row-oriented (heap + MVCC): each row stored contiguously, tuned for point lookups and transactions' },
    ],
  },
  {
    label: 'OLTP: single-row reads/writes',
    cells: [
      {
        kind: 'no',
        text: 'No true row-level UPDATE/DELETE — an ALTER … DELETE rewrites entire affected parts and can visibly degrade the cluster',
      },
      {
        kind: 'yes',
        text: 'Purpose-built for this: MVCC, row locks and indexes make single-row transactions fast and safe',
      },
    ],
  },
  {
    label: 'Aggregation over large tables',
    cells: [
      {
        kind: 'yes',
        text: 'Vectorized execution plus columnar compression aggregates billions of rows per second without hand-tuned indexes',
      },
      {
        kind: 'partial',
        text: 'Fast with the right B-tree/BRIN indexes and enough RAM, but full-table scans over huge fact tables are inherently slower on row storage; Citus/columnar extensions close some of the gap',
      },
    ],
  },
  {
    label: 'Joins',
    cells: [
      {
        kind: 'partial',
        text: 'JOIN support and the query planner have improved a lot, but denormalizing wide tables is still the idiomatic ClickHouse pattern for best performance',
      },
      { kind: 'yes', text: 'A mature cost-based planner handles complex multi-table joins well out of the box' },
    ],
  },
  {
    label: 'Indexing',
    cells: [
      {
        kind: 'partial',
        text: 'Performance depends on the primary key sort order plus skip indices — no general-purpose secondary index',
      },
      { kind: 'yes', text: 'Rich secondary indexing: B-tree, GIN, GiST, BRIN, partial and expression indexes' },
    ],
  },
  {
    label: 'Concurrency model',
    cells: [
      {
        kind: 'partial',
        text: 'Tuned for fewer, heavier analytical queries rather than thousands of small concurrent transactions',
      },
      { kind: 'yes', text: 'MVCC handles many concurrent small transactions cleanly — the OLTP sweet spot' },
    ],
  },
  {
    label: 'Compression & storage cost at scale',
    cells: [
      {
        kind: 'yes',
        text: "Columnar compression routinely reaches 10x+ on typical analytical data, cutting both storage and I/O",
      },
      {
        kind: 'partial',
        text: "Standard TOAST/page compression is modest; matching ClickHouse's ratios needs a columnar extension (Citus columnar, TimescaleDB Hypercore)",
      },
    ],
  },
  {
    label: 'Ecosystem & extensions',
    cells: [
      {
        kind: 'partial',
        text: 'A narrower, fast-growing catalog: Kafka/S3/MySQL/PostgreSQL table engines, dbt-clickhouse, Grafana/Superset support',
      },
      {
        kind: 'yes',
        text: 'The deepest extension ecosystem in open-source databases: PostGIS, pgvector, TimescaleDB, Citus, decades of drivers and ORMs',
      },
    ],
  },
  {
    label: 'Licensing',
    cells: [
      { kind: 'plain', text: 'Apache 2.0' },
      { kind: 'plain', text: 'The PostgreSQL License — a permissive, OSI-approved license with effectively no restrictions' },
    ],
  },
  {
    label: 'Best fit',
    cells: [
      {
        kind: 'plain',
        text: 'Analytics dashboards, event/log analytics, and ad hoc GROUP BY over historical data at a scale where indexes stop helping',
      },
      {
        kind: 'plain',
        text: 'Transactional application data, referential integrity, and analytics that fit comfortably within what indexes and RAM can cover',
      },
    ],
  },
]

export const druidPinotRows: DbComparisonRow[] = [
  {
    label: 'Primary design goal',
    cells: [
      { kind: 'plain', text: 'General-purpose OLAP: one engine for ad hoc SQL analytics and dashboards' },
      {
        kind: 'plain',
        text: 'Real-time OLAP for sub-second interactive dashboards over streaming plus historical data',
      },
      {
        kind: 'plain',
        text: 'Ultra-low-latency, high-QPS analytics embedded directly in user-facing products (built at LinkedIn)',
      },
    ],
  },
  {
    label: 'Node architecture',
    cells: [
      {
        kind: 'plain',
        text: 'Comparatively simple: ClickHouse server nodes plus built-in Keeper for replication coordination',
      },
      {
        kind: 'plain',
        text: 'Multiple specialized services — Coordinator, Overlord, Broker, Historical, MiddleManager — plus ZooKeeper and deep storage (S3/HDFS)',
      },
      { kind: 'plain', text: 'Three-tier — Controller, Broker, Server — plus ZooKeeper and deep storage' },
    ],
  },
  {
    label: 'Real-time streaming ingestion',
    cells: [
      {
        kind: 'partial',
        text: 'The Kafka table engine and materialized views support streaming, but batch inserts are the idiomatic pattern — frequent tiny inserts create excess parts',
      },
      {
        kind: 'yes',
        text: 'Built natively for continuous Kafka/Kinesis ingestion with segment-based real-time-to-historical handoff',
      },
      { kind: 'yes', text: 'Same native streaming design — events are indexed as soon as they land, for immediate queryability' },
    ],
  },
  {
    label: 'Query latency at high concurrency',
    cells: [
      {
        kind: 'partial',
        text: 'Scales to high concurrency but is tuned more for large ad hoc scans than guaranteed sub-second SLAs at massive QPS',
      },
      { kind: 'yes', text: 'Optimized for sub-second interactive dashboard queries' },
      { kind: 'yes', text: 'Explicitly built for very high QPS, single-digit-millisecond point and aggregation lookups' },
    ],
  },
  {
    label: 'SQL completeness & ad hoc flexibility',
    cells: [
      {
        kind: 'yes',
        text: 'The richest, most complete SQL dialect of the three — the strongest fit for exploratory, hand-written analytical SQL',
      },
      {
        kind: 'partial',
        text: 'Druid SQL covers most common queries but with more restrictions than a general-purpose SQL engine, particularly around joins',
      },
      {
        kind: 'partial',
        text: 'A Calcite-based SQL layer over the native query API; join support has historically been limited',
      },
    ],
  },
  {
    label: 'Operational complexity',
    cells: [
      { kind: 'yes', text: 'Fewer moving parts: no mandatory ZooKeeper for a single-node or simple replicated setup' },
      {
        kind: 'no',
        text: 'A heavier footprint: multiple specialized services, ZooKeeper and deep storage are required even for small deployments',
      },
      { kind: 'no', text: 'Same story: ZooKeeper, deep storage and multiple service tiers required from day one' },
    ],
  },
  {
    label: 'Deployment footprint (small workloads)',
    cells: [
      { kind: 'yes', text: 'Runs comfortably as a single node for small-to-medium workloads, then scales out' },
      { kind: 'no', text: 'Architected for distributed operation from the start — comparatively heavy for a small deployment' },
      { kind: 'no', text: 'Same — designed distributed-first' },
    ],
  },
  {
    label: 'Proven at scale',
    cells: [
      { kind: 'plain', text: 'General analytics and log/event data — including product-analytics backends like PostHog' },
      { kind: 'plain', text: 'Real-time streaming dashboards at companies including Netflix and Confluent' },
      { kind: 'plain', text: 'User-facing real-time features at LinkedIn (50+ products) and Uber, serving 100K+ QPS at millisecond latency' },
    ],
  },
  {
    label: 'Licensing',
    cells: [
      { kind: 'plain', text: 'Apache 2.0' },
      { kind: 'plain', text: 'Apache 2.0 (Apache Software Foundation project)' },
      { kind: 'plain', text: 'Apache 2.0 (Apache Software Foundation project)' },
    ],
  },
  {
    label: 'Best fit',
    cells: [
      { kind: 'plain', text: 'Pick this for general-purpose analytics, ad hoc SQL, and the simplest ops of the three' },
      { kind: 'plain', text: 'Pick this for streaming-native, sub-second interactive dashboards over time-partitioned event data' },
      { kind: 'plain', text: 'Pick this for extremely high-QPS, low-latency analytics features baked directly into a product' },
    ],
  },
]
