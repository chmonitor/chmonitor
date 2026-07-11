---
title: "Monitoring PeerDB: snapshot progress, batch history, fleet lag, and slot health"
description: "chmonitor's PeerDB section grew up — per-table snapshot progress, CDC batch history, a fleet-wide lag triage strip, a logs feed, and replication slot health, all read-only."
date: 2026-07-11
tag: Feature
---

If you're moving data from Postgres into ClickHouse, there's a good chance
[PeerDB](https://docs.peerdb.io) is doing the moving. It's the CDC engine
[ClickHouse acquired in 2024](https://clickhouse.com/blog/clickhouse-welcomes-peerdb-adding-the-fastest-postgres-cdc-to-the-fastest-olap-database)
and now runs as the connector behind ClickPipes for Postgres — [more than 400
companies](https://clickhouse.com/blog/postgres-cdc-year-in-review-2025)
replicate over 200 TB of Postgres data through it every month. PeerDB itself
stays free and open source under ELv2, whether you run it standalone or as
part of ClickHouse Cloud.

chmonitor has shipped a read-only PeerDB section for a while — mirrors, peers,
basic status. This release makes it a real operating surface: snapshot
progress, CDC batch history, a fleet-wide lag triage strip, a unified logs
feed, and replication slot health.

## Why a CDC pipeline needs its own monitoring

A logical-replication pipeline fails in ways a batch job doesn't:

- **Lag creeps, then spikes.** A mirror can look healthy for days and then
  fall behind when a downstream sink stalls or a source table gets a burst of
  writes. Catching that early is the difference between a five-minute blip and
  a stale dashboard.
- **Replication slots don't clean up after themselves.** A logical
  replication slot holds Postgres WAL until every subscriber has consumed it.
  If a mirror pauses or lags long enough, [WAL can grow to hundreds of
  gigabytes and take the source database down with
  it](https://blog.peerdb.io/overcoming-pitfalls-of-postgres-logical-decoding) —
  slot health isn't a nice-to-have metric, it's a guard against an outage on
  the *source* system, not just the pipeline.
- **Snapshots and batches fail quietly.** Initial loads and individual CDC
  batches can stall or error without necessarily flipping the mirror to a
  loud "down" state. You want to see partition progress and batch history
  directly, not infer it from a stale row count.

## What chmonitor shows now

<img src="/assets/screenshots/peerdb-overview-with-bg.png" alt="chmonitor PeerDB Mirrors: fleet status tiles (running, snapshotting, paused, failed), rows-synced trends per mirror, peer topology, pipeline phase and peer info" width="1598" height="1052" loading="lazy" decoding="async" />

<div class="hl-grid">
  <div class="hl"><b>Snapshot progress</b><span>Per-table initial-load progress from PeerDB's initial_load data — partitions completed, rows synced, average time per partition, and fetch/consolidate phase.</span></div>
  <div class="hl"><b>CDC batch history</b><span>Recent batches with id, LSN range, rows, and duration, plus a rows-per-batch chart on the mirror detail page.</span></div>
  <div class="hl"><b>Operation mix</b><span>Per-table insert/update/delete split, so you can see what kind of writes are actually flowing through a mirror.</span></div>
  <div class="hl"><b>Fleet lag triage</b><span>A worst-lag strip on the mirrors index — the 5 mirrors furthest behind, deep-linked straight to their detail page.</span></div>
  <div class="hl"><b>Fleet logs feed</b><span>A collapsible feed aggregating logs and alerts across every mirror, filterable by error / warn / info.</span></div>
  <div class="hl"><b>Slot health</b><span>Replication slots across all Postgres peers, classified ok / warn / critical by lag, active state, and WAL status, worst-first, on the Peers page.</span></div>
</div>

<img src="/assets/screenshots/peerdb-detail-with-bg.png" alt="chmonitor PeerDB mirror detail: throughput, replication lag, cumulative rows synced, partition sync history chart and per-partition QRep progress" width="1515" height="1030" loading="lazy" decoding="async" />

Peer detail pages also show the peer's redacted config, server version, and
active queries — so if a mirror looks slow, you can check what else is
running on the source without leaving chmonitor.

## Read-only, proxied, same as everything else

chmonitor never talks to Postgres or ClickHouse directly for this section —
it proxies a read-only allowlist of the PeerDB REST API
(`app/api/v1/peerdb/[...slug]`). Mutating calls (create, drop, pause,
maintenance) are rejected with `403` at the proxy layer, so there's no path
for chmonitor to change what PeerDB is doing. The credential lives
server-side only, and anything secret-shaped in peer config is masked before
it reaches the browser.

## Connect it

Set `PEERDB_API_URL` (and `PEERDB_PASSWORD` if your API requires auth), or
add a PeerDB monitoring link when creating a host from the connection form's
Advanced section. Full setup, caching knobs, and troubleshooting are in the
[PeerDB monitoring docs](https://docs.chmonitor.dev/operate/advanced/peerdb-monitoring).

It pairs naturally with [Postgres as a monitored source
(beta)](/blog/postgres-monitoring-beta) — monitor the source database and the
mirror moving its data in the same dashboard.

Try it on the [live dashboard](https://dash.chmonitor.dev), or open an issue
on [GitHub](https://github.com/chmonitor/chmonitor) with feedback.
