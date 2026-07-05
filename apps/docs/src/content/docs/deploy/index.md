---
title: "Choosing a Platform"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/deploy.mdx"
sidebar:
  label: Overview
  order: 0
---

Deploy chmonitor wherever your ClickHouse runs. Pick the platform that matches your infrastructure; each platform page is self-contained with install steps, all config categories, and migration notes.

## Platforms

| Platform | Best for | Auth options | Notes |
|---|---|---|---|
| [Docker](/deploy/docker) | Single-server self-host | none / clerk / proxy | Fastest path; pin a release tag |
| [Kubernetes](/deploy/k8s) | Cluster-managed, multi-replica | none / clerk / proxy | Helm chart vendored in-repo; kustomize alternative |
| [Cloudflare Workers](/deploy/cloudflare) | Edge / serverless | none / clerk / Cloudflare Access | D1 + Durable Objects for conversation store; Cron Trigger for health sweep |
| [Vercel](/deploy/vercel) | Quick hosted preview (Next.js legacy app) | none / clerk / API key / reverse proxy | Use postgres or clickhouse for conversation store; no D1/DO |
| [Node / standalone](/deploy/self-host) | Custom server, systemd, bare VM | none / clerk / proxy | `pnpm run start` or `node server.js`; put behind nginx |

## Configuration categories

Every platform shares the same configuration categories. The links below go to the reference page for each.

| Category | What it controls | Reference |
|---|---|---|
| ClickHouse connection | Hosts, credentials, query timeout, pool | [Configuration](/reference/configuration) |
| Query / pool tuning | Execution time, cache TTL, pool size | [Configuration](/reference/configuration) |
| Feature permissions | Enable/disable features; public vs authenticated access | [Features](/features) |
| Authentication | none / clerk / proxy (CF Access or trusted header) | [Authentication](/authentication) |
| AI agent | LLM key, model, control tools, agent API token | [AI Agent](/ai-agent) |
| Conversation store | Browser local / agentstate / D1 / postgres / clickhouse | [AI Agent](/ai-agent) |
| Health alerting | Cron sweep, webhook URL, severity threshold | [Configuration](/reference/configuration) |
| Branding / analytics | Title, logo, GA / PostHog / Seline | [Configuration](/reference/configuration) |

## Not sure where to start?

- **Running Docker already?** → [Docker](/deploy/docker)
- **On Kubernetes?** → [Kubernetes](/deploy/k8s)
- **Want serverless edge?** → [Cloudflare Workers](/deploy/cloudflare)
- **Behind Traefik / a reverse proxy?** → [Traefik](/deploy/traefik)
- **Before going to production?** → [Production checklist](/deploy/production-checklist)
