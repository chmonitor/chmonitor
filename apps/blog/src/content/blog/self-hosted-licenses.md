---
title: "We're selling a commercial license — and we trust you"
description: "chmonitor started as a hosted dashboard. Users told us that does not fit how they work. So we sell a self-hosted license on the honor system, and spend the time on the core product."
date: 2026-08-17
updated: 2026-08-21
tag: Product
---

chmonitor started as a **SaaS cloud**: we ran the dashboard for you, no setup, sold seats, and metered usage.

We changed our mind. Users kept telling us why.

Most people who would use chmonitor already work at a company with DevOps. They already run ClickHouse. They can deploy on their own infra — Docker, Helm, whatever they already operate. Paying us monthly to host a UI they can run next to the cluster is a hard sell.

The data is also company property. Query text, table names, cluster topology — that is production signal. People who reach out ask for security proof, IP allowlists, an isolated environment, a binary they can inspect — so the security team can approve it. A hosted dashboard sitting on our cloud has to win all of that before the first login. Self-hosting skips the argument.

## Why SaaS does not fit

- You already have people who can deploy it.
- You already run ClickHouse. The dashboard should sit next to it.
- Security teams want allowlists, isolation, and a trusted source. Hosted SaaS rarely passes that bar.
- Monitoring reads `system.query_log`. That is not data you send to a vendor without a fight.

So we stopped trying to be “the cloud that runs your dashboard.”

That is why we changed it today: **spend the time on the core** — the pages, the advisor, the agent — and sell a commercial license for teams that need an invoice. The software stays GPL-3.0. No license key. We trust you.

## The offer

The GPL-3.0 build is still free. Unlimited hosts. No key. No nag screen.

If you want an invoice, email support, and a commercial agreement, buy a license sized by **how many hosts you monitor**:

| License | Hosts | Yearly | Lifetime |
|---|---|---|---|
| Personal Self Hosted | unlimited | $0 | — |
| Team | 3 | $499 | $1,349 |
| Unlimited | unlimited | $999 | $2,999 |

Lifetime is a one-time payment if you hate renewals.

A **host** is one monitored connection (one ClickHouse endpoint, or one Postgres source). **Replicas in the same shard are not counted.** You pay for the cluster you operate, not for every redundant copy.

<figure>
  <img src="/posts/self-hosted-licenses/pricing.jpeg" alt="chmonitor pricing: Personal self-hosted at $0, Team at $499/year for 3 hosts, Unlimited at $999/year" width="2838" height="1736" />
  <figcaption>Pricing on <a href="https://chmonitor.dev/pricing/">chmonitor.dev/pricing</a> — yearly or lifetime, honor system.</figcaption>
</figure>

## How purchase works (the trust model)

There is no license key that unlocks features. After you pay we ask for **company name** and **website**. We trust you to buy the host count you actually use.

You can opt in to appear on the [customers](https://chmonitor.dev/customers) page. Default is private.

Start at [pricing](https://chmonitor.dev/pricing/) — Buy opens Polar checkout, then you register your company. Details: [commercial license docs](https://docs.chmonitor.dev/operate/advanced/commercial-license).

## What about dash.chmonitor.dev?

It stays up if you do not want to operate the app — demos, side projects, teams that are allowed to send metadata to a vendor.

For everyone already running ClickHouse behind a firewall, **self-host + license** is the product that matches how you work.

Deploy it next to the cluster:

- [Docker, in five minutes](/clickhouse-self-hosting-docker/)
- [Kubernetes with Helm](/self-hosting-chmonitor-helm/)
