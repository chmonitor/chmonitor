---
title: "Product Telemetry"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/advanced/telemetry.mdx"
---

chmonitor includes an opt-in, anonymous telemetry system. It is **off by default** — no data leaves your instance unless you explicitly enable it.

This is separate from [Self-Tracking](/advanced/self-tracking), which writes dashboard usage events to your own ClickHouse instance. Telemetry is lightweight product analytics (five events, three dimensions, no PII) intended to help the project understand how the dashboard is used at a high level.

---

## Off by default

Telemetry is disabled unless you set one of the following environment variables:

| Variable | Where it applies | Value to enable |
|---|---|---|
| `CHM_TELEMETRY` | Server runtime (Worker binding / `process.env`) | `on` |
| `VITE_TELEMETRY_ENABLED` | Client build-time (inlined by Vite) | `true` |

`CHM_TELEMETRY=on` is the canonical form. `true`, `1`, and `yes` are also accepted. Any other value — including unset — keeps telemetry off.

---

## What is collected

### Events

| Event | When it fires |
|---|---|
| `app_loaded` | Dashboard page first loads |
| `cluster_connected` | A ClickHouse connection is established |
| `health_viewed` | Health page is opened |
| `queries_viewed` | Queries page is opened |
| `ai_query_sent` | A natural language query is sent to the AI agent |

### Dimensions (attached to every event)

| Dimension | Values | Example |
|---|---|---|
| `deploy_target` | `docker`, `helm`, `cf`, `dev`, `unknown` | `docker` |
| `ch_version` | `MAJOR.MINOR` only | `24.8` |
| `ch_flavor` | `oss`, `altinity`, `cloud`, `unknown` | `oss` |

---

## What is NOT collected

- Query text, SQL statements, or fingerprints
- Hostnames, IP addresses, or connection strings
- User identifiers, email addresses, or session tokens
- Table names, database names, or schema information
- Any free-text or user-generated content

A defensive redaction layer (`redact.ts`) runs before every event is emitted. It drops any prop whose key name implies sensitive content (`host`, `ip`, `url`, `query`, `sql`, `email`, `token`, …) and any string value that matches an email, IPv4/IPv6 address, or URL pattern. When in doubt, it drops.

The ClickHouse version is always truncated to `MAJOR.MINOR` (e.g. `24.8`) — never the full four-part string — to avoid matching the IPv4 redaction pattern.

---

## How to enable

**Server-side** (Cloudflare Worker, Docker, Kubernetes):

```bash
CHM_TELEMETRY=on
```

**Client build-time** (inlined at `pnpm run build` / `vite build`):

```bash
VITE_TELEMETRY_ENABLED=true
```

Both variables are independent. You can enable server-side telemetry without a client rebuild or vice versa.

---

## How to disable

Telemetry is off by default — you do not need to do anything to disable it. To confirm it is off, ensure neither `CHM_TELEMETRY` nor `VITE_TELEMETRY_ENABLED` is set (or set them to any value other than the accepted ones above).

---

## Current transport status

There is currently **no default network sink**. Events are typed, redacted, and emitted internally, but no transport is wired yet — meaning even when enabled, events go nowhere. A self-hosted sink (writing to your own ClickHouse) will be added in a later release. This means enabling telemetry today has no effect on data leaving your instance.

---

## Activation metric

The project tracks a single derived metric called "activation":

> activation = `cluster_connected` AND (`health_viewed` OR `queries_viewed`)

A session is considered activated when a cluster is connected and the user viewed either the Health or Queries page in that session. This definition lives in `activation.ts` and is the same across the client, any analytics query over the telemetry store, and this documentation.

---

## Privacy stance

- **Opt-in only** — telemetry is off unless you set the env var.
- **Self-hosted** — chmonitor is fully self-hostable; your ClickHouse data never leaves your network regardless of telemetry settings.
- **No third-party trackers** — there are no analytics SDKs, beacon scripts, or third-party pixels in the application.
- **No PII by design** — the event schema and redaction layer are written to make PII collection structurally impossible, not just policy-forbidden.
- **Inert today** — no transport sink is wired, so enabling telemetry currently produces no network traffic.

---

## Related

- [Self-Tracking](/advanced/self-tracking) — writes dashboard usage events (page visits, query executions) to your own ClickHouse instance. A different system, entirely within your infrastructure.
- [Environment Variables](/reference/environment-variables) — full reference for all configuration variables.
