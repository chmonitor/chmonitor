---
title: "We're selling self-hosted licenses, not cloud seats"
description: "If you already run ClickHouse, buy a yearly or lifetime license sized by host count. The binary stays free. No license key."
date: 2026-08-17
tag: Product
---

Most people who would use chmonitor already have an infra team. They are not going to pay us monthly to host a dashboard they can `docker run` next to ClickHouse.

So the paid product is now a **commercial license for the software you self-host**, not a SaaS seat.

## The offer

The GPL-3.0 build is still free. Unlimited hosts. No key. No nag screen.

If you want an invoice, email support, and a commercial agreement, buy a license sized by **how many hosts you monitor**:

| License | Hosts | Yearly | Lifetime |
|---|---|---|---|
| Personal Self Hosted | unlimited | $0 | — |
| Team | 3 | $499 | $1,349 |
| Unlimited | unlimited | $999 | $2,999 |

Lifetime is a one-time payment if you hate renewals.

A host is one monitored connection (one ClickHouse endpoint, or one Postgres source). Replicas in the same shard count as 0.5.

## How purchase works

There is no license key to paste into `CHM_*`. After you pay we ask for **company name** and **website**. Honor system — we trust you.

You can opt in to appear on the [customers](https://chmonitor.dev/customers) page. Default is private.

Start at [pricing](https://chmonitor.dev/pricing/) — Buy opens Polar checkout, then you register your company. Details: [commercial license docs](https://docs.chmonitor.dev/operate/advanced/commercial-license).

## What about dash.chmonitor.dev?

It stays up if you do not want to operate the app. For everyone already running ClickHouse, self-host + license is the path that matches how you work.

See [Self-hosting on Docker](https://blog.chmonitor.dev/clickhouse-self-hosting-docker) if you have not deployed yet.
