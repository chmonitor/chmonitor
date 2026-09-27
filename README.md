<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo.png">
    <img src=".github/logo.png" alt="chmonitor" width="120" height="120">
  </picture>
</p>

<h1 align="center">chmonitor</h1>
<p align="center"><strong>The operational advisor for ClickHouse</strong></p>

[![Build and Test](https://github.com/chmonitor/chmonitor/actions/workflows/ci.yml/badge.svg)](https://github.com/chmonitor/chmonitor/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/chmonitor/chmonitor?style=flat&logo=github&label=stars)](https://github.com/chmonitor/chmonitor/stargazers)
[![Latest release](https://img.shields.io/github/v/release/chmonitor/chmonitor?sort=semver&label=release)](https://github.com/chmonitor/chmonitor/releases)
[![Docker image](https://img.shields.io/badge/ghcr.io-chmonitor%2Fchmonitor-2496ED?logo=docker&logoColor=white)](https://github.com/chmonitor/chmonitor/pkgs/container/chmonitor)
[![License](https://img.shields.io/github/license/chmonitor/chmonitor)](LICENSE)

<p align="center">
  <a href="https://dash.chmonitor.dev/overview?host=0"><strong>Live demo</strong></a>
  · <a href="https://chmonitor.dev/">Website</a>
  · <a href="https://docs.chmonitor.dev">Docs</a>
  · <a href="https://docs.chmonitor.dev/guide/getting-started">Getting started</a>
  · <a href="#quick-start">Quick start</a>
</p>

<p align="center">
  <img alt="chmonitor v0.3 launch film" src=".github/videos/launch-v0-3.gif">
</p>
<p align="center">
  <a href="https://chmonitor.dev/watch/v0-3"><strong>Watch the v0.3 launch film</strong></a>
</p>

**chmonitor** is a dashboard and advisor for ClickHouse. It reads `system.*`
tables and shows what the cluster is doing — queries, merges, replication,
storage, health — then recommends what to change next.

It does **not** apply DDL for you. Recommendations stay recommendations.

Runs the same way on Docker, Kubernetes, bare metal, or ClickHouse Cloud.
Self-host it free (GPL-3.0), or use the [hosted demo](https://dash.chmonitor.dev/overview?host=0).

Current release: **[v0.3.6](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.6)**.
Upgrading from v0.2? See [Migrate to v0.3](https://docs.chmonitor.dev/reference/migrating/v0-3).

---

## What it does

| You need | chmonitor |
|---|---|
| See the cluster | Overview, topology, health checks, 30+ charts |
| Catch expensive work | Running, slow, failed, and historical queries |
| Understand data | Explorer, table size, parts, compression, TTLs |
| Keep replicas healthy | Merges, mutations, replication queue, Keeper |
| Get a second opinion | AI advisor: projections, skip indexes, PREWHERE, MVs |
| Ask in English | Built-in AI agent + [MCP](https://docs.chmonitor.dev/reference/mcp-clients) for Claude / Cursor |
| Work from a terminal | [`chm` CLI](https://chmonitor.dev/cli) — live TUI and `chm doctor` |

Works with **multiple ClickHouse hosts** from one dashboard (`?host=0`).

More detail: [docs](https://docs.chmonitor.dev) · [AI agent](https://docs.chmonitor.dev/guide/ai-agent) · [editions](https://docs.chmonitor.dev/operate/advanced/editions)

---

## Quick start

One container, pointed at any reachable ClickHouse (OSS, Altinity, or ClickHouse Cloud):

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:0.3.6
```

Open **http://localhost:3000**. Pin a version tag in production; use `:latest` only if you want the rolling tip.
Image tags carry no `v` prefix — the release `v0.3.6` publishes `0.3.6`, plus
`0.3` and `latest`.

Want a look first? **[dash.chmonitor.dev](https://dash.chmonitor.dev/overview?host=0)** — no setup.

Install the CLI:

```bash
curl -sSf https://chmonitor.dev/install.sh | bash
chm doctor
```

---

## Deploy

Same `CLICKHOUSE_HOST` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` everywhere.

| Target | Guide |
|---|---|
| Docker | [docs/operate/deploy/docker](https://docs.chmonitor.dev/operate/deploy/docker) |
| Kubernetes (Helm) | [docs/operate/deploy/k8s](https://docs.chmonitor.dev/operate/deploy/k8s) |
| Cloudflare Workers | [docs/operate/deploy](https://docs.chmonitor.dev/operate/deploy) |
| Railway / Render / Fly | [One-click](https://docs.chmonitor.dev/operate/deploy/one-click) |
| Local development | [Getting started](https://docs.chmonitor.dev/guide/getting-started/local) |

Release artifacts (Docker image, Node standalone, Workers archive) are on the
[GitHub Releases](https://github.com/chmonitor/chmonitor/releases) page.

---

## Editions

chmonitor is **GPL-3.0**: self-host every feature, unlimited hosts, no payment, no
key. A commercial license is optional and buys paper, not features — an invoice
and named vendor, priority email support for the paid term, and an opt-in listing.
Same binary either way.

| License | Hosts | Yearly | Lifetime |
|---|---|---|---|
| Personal Self Hosted | Unlimited | Free | Free |
| Team | 3 | $499 | $1,349 |
| Unlimited | Unlimited | $999 | $2,999 |

You do not get extra dashboard features versus the free build today. A **host**
is one monitored connection; replicas in the same shard are not counted.

Details: [Editions](https://docs.chmonitor.dev/operate/advanced/editions) ·
[Commercial license](https://docs.chmonitor.dev/operate/advanced/commercial-license) ·
[Buy](https://chmonitor.dev/license).

---

## Sponsors

Self-hosting is free under GPL-3.0. Sponsorship is not a license — it buys no
features, no support window, and no key. It funds the free build, and it earns a
listing.

| Tier | One-off | You get |
|---|---|---|
| Supporter | $19 | Your name on the sponsors page |
| Backer | $59 | Your name and a link to your site on the sponsors page |
| Hero | $99 | Your logo and link under the homepage hero, plus the sponsors page |
| Partner | $199 | A larger hero slot, plus a short line about you on the sponsors page |

Want to support the free build? **[Start sponsoring](https://chmonitor.dev/license#sponsor)** —
from $19 one-off, or $99 to put your logo under the homepage hero.

The wall: [chmonitor.dev/sponsors](https://chmonitor.dev/sponsors). A commercial
license is a separate thing — see [Editions](#editions).

---

## Screenshots

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/overview-with-charts-dark-with-bg.jpeg">
  <img alt="Overview charts: query count, duration, and data written over time" src=".github/screenshots/overview-with-charts-dark-with-bg.jpeg">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/cluster-topology-dark.png">
  <img alt="Cluster topology: nodes, shards, replicas, and Keeper quorum" src=".github/screenshots/cluster-topology-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/cluster-insights-dark.png">
  <img alt="Cluster insights: findings, record-breaking queries, storage stats" src=".github/screenshots/cluster-insights-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/ai-agent-dark.png">
  <img alt="AI agent: ask about schema, storage, queries, and health" src=".github/screenshots/ai-agent-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/sql-console-dark.png">
  <img alt="SQL console: read-only SQL with history and EXPLAIN" src=".github/screenshots/sql-console-light.png">
</picture>

---

## Docs

- [Getting started](https://docs.chmonitor.dev/guide/getting-started) — ClickHouse user, system tables, first run
- [Deploy](https://docs.chmonitor.dev/operate/deploy) — Docker, Kubernetes, Workers, one-click
- [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — tools, skills, env
- [MCP clients](https://docs.chmonitor.dev/reference/mcp-clients) — Claude, Cursor, and other clients
- [Editions](https://docs.chmonitor.dev/operate/advanced/editions) — what a license does and does not unlock
- [Commercial license](https://docs.chmonitor.dev/operate/advanced/commercial-license) — SKUs, prices, `CHM_LICENSE_KEY`
- [Sponsors](https://chmonitor.dev/sponsors) — the sponsor wall and the ladder
- [Environment variables](https://docs.chmonitor.dev/reference/environment-variables)
- [Connection errors](https://docs.chmonitor.dev/guide/guides/connection-errors)
- [Migrate to v0.3](https://docs.chmonitor.dev/reference/migrating/v0-3)
- Source in this repo: [`docs/content/`](docs/content/) · live site: [docs.chmonitor.dev](https://docs.chmonitor.dev)

---

## Contribute

Issues and pull requests are welcome. Agent instructions live in [`AGENTS.md`](AGENTS.md)
(`CLAUDE.md` includes that file).

## License

[GPL-3.0](LICENSE)

---

![Repo activity](https://repobeats.axiom.co/api/embed/830f9ce7ba9e7a42f93630e2581506ca34c84067.svg 'Repobeats analytics image')
