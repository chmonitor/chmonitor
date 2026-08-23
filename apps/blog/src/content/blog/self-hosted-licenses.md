---
title: "chmonitor selling commercial license"
description: "We used to sell hosted dashboard seats. Most people who run ClickHouse already have infra, and they cannot send cluster data to a vendor. So we sell a self-hosted license instead, and work on the product."
date: 2026-08-17
updated: 2026-08-21
tag: Product
cover: /og/blog/self-hosted-licenses.png
---

chmonitor started as a hosted dashboard. We ran the app, sold seats, metered usage.

That does not match who actually uses this. Most readers are engineers at companies that already have DevOps. They already run ClickHouse. Docker or Helm is a normal Tuesday. They are not going to pay monthly for a UI they can put next to the cluster.

Data is also a problem. Query text, table names, topology: that is company data. People who write in ask for allowlists, an isolated network, a binary they can inspect, something security will sign off on. A SaaS dashboard has to pass all of that before anyone logs in. Running it yourself does not.

## Why we dropped the SaaS pitch

You can deploy it. The cluster is already on your network. Security will not open ClickHouse to a random vendor. And `system.query_log` is not something you copy off-site without a fight.

So we stopped selling "we host the dashboard." Today the work goes into the product: pages, advisor, agent. If you need an invoice, buy a license. The app is still GPL-3.0. No key. We trust you on host count.

## The offer

OSS is free. Unlimited hosts. No nag screen.

Paid licenses are sized by how many hosts you monitor:

| License | Hosts | Yearly | Lifetime |
|---|---|---|---|
| Personal Self Hosted | unlimited | $0 | — |
| Team | 3 | $499 | $1,349 |
| Unlimited | unlimited | $999 | $2,999 |

Lifetime is one payment if you do not want renewals.

A host is one connection (one ClickHouse endpoint, or one Postgres source). Replicas in the same shard are not counted.

<figure>
  <img src="/posts/self-hosted-licenses/pricing.jpeg" alt="chmonitor pricing: Personal self-hosted at $0, Team at $499/year for 3 hosts, Unlimited at $999/year" width="2838" height="1736" />
  <figcaption>Pricing on <a href="https://chmonitor.dev/pricing/">chmonitor.dev/pricing</a>.</figcaption>
</figure>

## How you buy it

Pay on Polar. We ask for company name and website. There is no license key that unlocks features. Use the host count you paid for.

Listing on the [customers](https://chmonitor.dev/customers) page is optional and off by default.

[Pricing](https://chmonitor.dev/pricing/) → Buy → Polar. Docs: [commercial license](https://docs.chmonitor.dev/operate/advanced/commercial-license).

## dash.chmonitor.dev

Still there if you do not want to run the app (demo, side project, or a team that is allowed to send metadata out).

If ClickHouse is behind a firewall, run the dashboard next to it:

- [Docker](/clickhouse-self-hosting-docker/)
- [Helm on Kubernetes](/self-hosting-chmonitor-helm/)
