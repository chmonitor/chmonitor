---
title: "Self-hosting chmonitor on Docker in five minutes"
description: "Run the chmonitor ClickHouse dashboard as a self-hosted Docker container against your own cluster, no signup or cloud account required."
date: 2026-07-10
tag: How-to
---

This is for anyone who wants a ClickHouse dashboard running against their own cluster without handing credentials to a third party. chmonitor's Docker image is the same codebase as the hosted Cloud product — self-hosted just means you run the container yourself. By the end you'll have it up on `localhost:3000` and pointed at a real cluster.

## Prerequisites

- Docker installed and running.
- A reachable ClickHouse endpoint and a monitoring user with `SELECT` on `system.*`.
- A release tag to pin (browse [releases](https://github.com/chmonitor/chmonitor/pkgs/container/chmonitor) — avoid `:latest` in anything you plan to keep running, since an unpinned tag drifting under you is a real failure mode, not a hypothetical).

## Steps

### 1. Pull and run

```bash
docker run -d --name chmonitor -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e CLICKHOUSE_HOST='http://host.docker.internal:8123' \
  -e CLICKHOUSE_USER='monitoring' \
  -e CLICKHOUSE_PASSWORD='change-me' \
  ghcr.io/chmonitor/chmonitor:vX.Y.Z
```

Replace `vX.Y.Z` with a real release tag. The `--add-host` flag is only needed on Linux, when ClickHouse runs on the same Docker host — Docker Desktop for Mac/Windows already resolves `host.docker.internal` without it.

Open `http://localhost:3000`.

### 2. Or use Docker Compose

```yaml
services:
  chmonitor:
    image: ghcr.io/chmonitor/chmonitor:vX.Y.Z
    ports:
      - '3000:3000'
    environment:
      CLICKHOUSE_HOST: 'http://clickhouse:8123'
      CLICKHOUSE_USER: 'monitoring'
      CLICKHOUSE_PASSWORD: 'change-me'
    healthcheck:
      test: ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3
```

If ClickHouse runs in the same Compose project, use the service name (`clickhouse` above) as the host directly — no `host.docker.internal` needed.

### 3. Point it at more than one host (optional)

`CLICKHOUSE_HOST` accepts a comma-separated list; `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD` can each be a single value applied to every host, or one value per position:

```bash
-e CLICKHOUSE_HOST='http://ch1:8123,http://ch2:8123' \
-e CLICKHOUSE_USER='monitoring,monitoring' \
-e CLICKHOUSE_PASSWORD='pass1,pass2' \
-e CLICKHOUSE_NAME='shard-1,shard-2'
```

### 4. Adjust query timeouts and pool size (optional)

```bash
-e CLICKHOUSE_MAX_EXECUTION_TIME='30' \
-e CLICKHOUSE_POOL_SIZE='10'
```

Defaults are a 60s query timeout and a pool size of 10 — raise the timeout if your workload has legitimately slow diagnostic queries, or the pool size if many people are hitting the dashboard concurrently.

## Verifying it worked

```bash
curl -sf http://localhost:3000/api/healthz && echo OK
```

`/api/healthz` is the readiness probe — it checks the container is up *and* that it can reach ClickHouse, so a green result here means the whole path is working, not just that the container started.

## Related

- Docs: [Docker deployment](https://docs.chmonitor.dev/operate/deploy/docker) — the full reference for this walkthrough, including feature-flag configuration via env vars or a mounted TOML file.
- Docs: [Production checklist](https://docs.chmonitor.dev/operate/deploy/production-checklist) — before putting a self-hosted instance in front of real users.
- Docs: [Kubernetes deployment](https://docs.chmonitor.dev/operate/deploy/k8s) — if you outgrow a single container.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] docker run / Compose commands copied verbatim from docs/content/operate/deploy/docker.mdx, checked against the source file in this repo.
- [x] CLICKHOUSE_HOST/USER/PASSWORD multi-host semantics checked against docs/content/operate/deploy/docker.mdx "Multiple hosts" section.
- [x] CLICKHOUSE_MAX_EXECUTION_TIME default (60) and CLICKHOUSE_POOL_SIZE default (10) checked against docs/content/operate/deploy/docker.mdx table.
- [x] /api/healthz verification command checked against docs/content/operate/deploy/docker.mdx "Verify" section.
- [x] This is a self-hosted-only walkthrough — no Cloud-only claims made; feature/config is merged to main.
- [x] Docs cross-links (docker.mdx, production-checklist.mdx, k8s.mdx) confirmed to exist in docs/content/operate/deploy/.
-->
