---
title: "We trust you to self-host. SaaS is the exception."
description: "Most chmonitor users are engineers who already run ClickHouse. Enterprises cannot send cluster metadata to a hosted dashboard. So the paid product is an honor-system license, not a SaaS seat with a license key."
date: 2026-08-17
updated: 2026-08-21
tag: Product
---

We started by thinking like a typical SaaS: host the dashboard, sell seats, meter usage.

That is the wrong product for ClickHouse operators.

Most people who would use chmonitor already work at a company with DevOps. They already run ClickHouse. They can `docker run` or Helm-install a dashboard next to the cluster in an afternoon. Paying us monthly to operate a UI they can run themselves is a hard sell — and for a lot of teams it is not even allowed.

So the paid product is not “cloud seats.” It is a **commercial license for software you self-host**, on the honor system. The hosted app at [dash.chmonitor.dev](https://dash.chmonitor.dev) stays up as a convenience. It is not the path we expect enterprises to take.

## Why SaaS does not fit

**You already have the people.** Typical readers are engineers, SREs, or ClickHouse DBAs. Standing up a container or a Helm chart is not a project. It is Tuesday.

**Security review kills hosted monitoring.** Enterprises need IP allowlists, private networks, and a trusted binary they can inspect. They will not open ClickHouse to an unknown vendor’s cloud, and they will not send query text, schema, and cluster topology off-network because a dashboard asked them to.

**Policy is not a checkbox.** Data residency, vendor questionnaires, SOC reviews, “no third-party processors for production metadata” — a hosted SaaS has to win all of those before the first login. Self-hosting skips the argument: the dashboard stays in *your* VPC.

**Leakage risk is real.** A monitoring tool that can `SELECT` from `system.query_log` sees table names, query shapes, sometimes literals. That is production signal. Trusting a SaaS with it is a procurement fight we do not want to force.

**We cannot DRM a GPL dashboard anyway.** The binary is open. A license key in `CHM_*` would be theater. We would rather be honest.

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

See [Self-hosting on Docker](https://blog.chmonitor.dev/clickhouse-self-hosting-docker) if you have not deployed yet.
