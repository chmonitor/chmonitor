---
title: "chmonitor now monitors PeerDB"
description: "Snapshot progress, CDC batch history, fleet-wide lag triage, a logs feed, and replication slot health — read-only, in the same dashboard as your ClickHouse cluster."
date: 2026-07-11
tag: Feature
---

If you move data from Postgres into ClickHouse, there's a good chance
[PeerDB](https://docs.peerdb.io) is doing the moving — it's the CDC engine
[ClickHouse acquired in 2024](https://clickhouse.com/blog/clickhouse-welcomes-peerdb-adding-the-fastest-postgres-cdc-to-the-fastest-olap-database)
and the connector behind ClickPipes for Postgres.

chmonitor's PeerDB section is now a real operating surface, not just a status
list.

<img src="/assets/screenshots/peerdb-overview-with-bg.png" alt="chmonitor PeerDB Mirrors: fleet status tiles (running, snapshotting, paused, failed), rows-synced trends per mirror, peer topology, pipeline phase and peer info" width="1598" height="1052" loading="lazy" decoding="async" />

<div class="hl-grid">
  <div class="hl"><b>Snapshot progress</b><span>Per-table initial-load progress — partitions completed, rows synced, average time per partition, and fetch/consolidate phase.</span></div>
  <div class="hl"><b>CDC batch history</b><span>Recent batches with id, LSN range, rows, and duration, plus a rows-per-batch chart.</span></div>
  <div class="hl"><b>Operation mix</b><span>Per-table insert/update/delete split, so you can see what kind of writes actually flow through a mirror.</span></div>
  <div class="hl"><b>Fleet lag triage</b><span>The 5 mirrors furthest behind, deep-linked straight to their detail page.</span></div>
  <div class="hl"><b>Fleet logs feed</b><span>Logs and alerts across every mirror, filterable by error / warn / info.</span></div>
  <div class="hl"><b>Slot health</b><span>Replication slots across all Postgres peers, classified ok / warn / critical, worst-first.</span></div>
</div>

<img src="/assets/screenshots/peerdb-detail-with-bg.png" alt="chmonitor PeerDB mirror detail: throughput, replication lag, cumulative rows synced, partition sync history chart and per-partition QRep progress" width="1515" height="1030" loading="lazy" decoding="async" />

Slot health is the one to watch. A logical replication slot holds Postgres WAL
until every subscriber has consumed it, so a paused or lagging mirror can
[grow WAL until it takes the source database down with
it](https://blog.peerdb.io/overcoming-pitfalls-of-postgres-logical-decoding) —
an outage on the *source*, not just the pipeline.

## Read-only by construction

chmonitor proxies a read-only allowlist of the PeerDB REST API. Mutating calls
(create, drop, pause, maintenance) are rejected with `403` at the proxy layer,
the credential stays server-side, and secret-shaped peer config is masked
before it reaches the browser.

## Connect it

Set `PEERDB_API_URL` (and `PEERDB_PASSWORD` if your API needs auth), or add a
PeerDB monitoring link in the connection form's Advanced section. Setup,
caching, and troubleshooting are in the [PeerDB monitoring
docs](https://docs.chmonitor.dev/operate/advanced/peerdb-monitoring).

It pairs with [Postgres as a monitored source
(beta)](/blog/postgres-monitoring-beta) — the source database and the mirror
moving its data, in one dashboard.

Try it on the [live dashboard](https://dash.chmonitor.dev), or open an issue on
[GitHub](https://github.com/chmonitor/chmonitor).
