---
id: github-repo-metadata
title: GitHub Repo Metadata (description + topics)
type: workflow
status: active
updated: 2026-07-17
tags:
  - seo
  - growth
  - discoverability
  - github
related:
  - release-automation
  - conventions
---

# GitHub Repo Metadata (description + topics)

The repo's `description` and `topics` are a first-class discoverability surface:
they appear in GitHub search, org repo listings, and are scraped verbatim by
"awesome-X" lists and directory sites. They also live **outside version
control**, which is exactly why they rot silently — nothing in CI fails when the
stack changes underneath them.

This note is the versioned source of truth for what they should say.

## Canonical values

**Description** (keep under ~140 chars; GitHub truncates):

```
Open-source operational advisor for ClickHouse — real-time monitoring plus AI-driven index/partition/materialized-view recommendations. Self-host or use the cloud.
```

It mirrors the README hero line — chmonitor is an *operational advisor*, not
just a metrics viewer. Lead with the AI-advisor differentiation, not dashboards.

**Topics:**

`chmonitor`, `clickhouse`, `duyet`, `monitoring`, `ai-agent`,
`cloudflare-workers`, `database-monitoring`, `mcp`, `observability`,
`open-source`, `self-hosted`, `tanstack-start`

**Banned topics:** `nextjs`, `vercel`. Both were wrong and actively misleading —
the Next.js migration is complete (TanStack Start replaced it) and the app
deploys to Cloudflare Workers / Docker / Kubernetes. There is no Vercel
deployment. A stack-detector or contributor reading those topics would set up
the wrong dev environment before opening a file.

## When to re-check

Re-read this note whenever the stack or positioning changes — specifically when
either of these changes, update the metadata in the same pass:

- `CLAUDE.md` "Project Overview" (stack / deployment targets)
- `README.md` hero line (positioning)

## How to apply

```bash
gh repo edit chmonitor/chmonitor --description "<canonical description above>"
gh repo edit chmonitor/chmonitor \
  --add-topic tanstack-start --add-topic cloudflare-workers \
  --add-topic observability --add-topic ai-agent --add-topic mcp \
  --add-topic self-hosted --add-topic open-source \
  --add-topic database-monitoring \
  --remove-topic nextjs --remove-topic vercel
```

Verify:

```bash
gh api repos/chmonitor/chmonitor | jq '.description, .topics'
```

## Possible follow-up

A CI job could assert the live metadata matches this note (read-only
`gh api repos/...`, fail on a banned topic or a description mismatch), turning
this from a convention into an enforced drift guard — the same move
`packages/mcp-server/src/data/__tests__/mcp-tools-data-drift.test.ts` made for
the MCP tool catalog. Not built yet; deliberately kept to a doc first.
