---
id: k8s-health-probes
title: Kubernetes Health Probes — /healthz vs /api/healthz
type: reference
status: active
updated: 2026-06-18
tags:
  - kubernetes
  - healthz
  - probes
  - deployment
  - helm
related:
  - deployment
  - release-automation
  - query-config-format
---

# Kubernetes Health Probes — `/healthz` vs `/api/healthz`

The dashboard exposes **two** health endpoints with different semantics. Wiring
them to the wrong kubelet probe is the #1 cause of chmonitor CrashLoopBackOff.

| Endpoint | Route file | What it checks | Status when ClickHouse is down |
|----------|------------|----------------|--------------------------------|
| `GET /healthz` | `apps/dashboard/src/routes/healthz.ts` (+ `/heathz` typo alias) | **Process alive** — returns `200 OK` instantly, no I/O | **200** (process is still up) |
| `GET /api/healthz` | `apps/dashboard/src/routes/api/healthz.ts` | **Ready to serve** — runs `SELECT 1` against every configured host | **503** (with `{ ok:false, hosts:[…] }`) |

## Probe mapping (the contract)

```
startupProbe  -> /healthz       # ~60s grace for the Nitro Node server to bind
livenessProbe -> /healthz       # static 200 = "don't kill me"
readinessProbe-> /api/healthz   # 200 = "send me traffic"; 503 = "drop me from Service"
```

**Why split:** liveness must never depend on ClickHouse. If liveness gated on
`/api/healthz`, a ClickHouse outage would make the kubelet **kill** every pod →
CrashLoopBackOff on top of the CH outage. Liveness is process-only (`/healthz`);
readiness is the only probe that pings ClickHouse, and readiness failure just
removes the pod from the Service (no restart).

## The `/api/healthz` timeout knob

`/api/healthz` pings each host with a bounded abort so one slow/dead host can't
hang the readiness check past the kubelet timeout:

```ts
abort_signal: AbortSignal.timeout(pingTimeoutMs) // default 3000ms
```

Override with the `CHM_HEALTHZ_TIMEOUT_MS` env var. **Constraint:**
`readinessProbe.timeoutSeconds` MUST be `> CHM_HEALTHZ_TIMEOUT_MS` (default
10s probe > 3s ping). `AbortSignal.timeout()` is supported on both runtimes
(Node ≥18 and workerd), so the route is runtime-agnostic — see
[deployment.md](deployment.md) for the dual Node/Worker target.

## The `:latest` gotcha (real incident, 2026-06-18)

The homelab deployed `image: ghcr.io/chmonitor/chmonitor:latest` with
`imagePullPolicy: Always`. CI (`ci.yml`) rebuilds `:latest` on every `push:main`,
but the image-build job had been **red for ~4 days** during a release-pipeline
breakage. `:latest` still resolved to a 4-day-old image that **predated the
`/healthz` route**. Result: liveness `/healthz` → **404** → 3 failures → kill →
CrashLoopBackOff (`BackOff x37`).

**Rules:**
- In production, **pin the image** to a version tag or digest (`0.2.x`, or
  `@sha256:…`), not `:latest`. The Helm chart defaults to the chart `appVersion`
  for exactly this reason.
- `:latest` + `Always` silently serves a stale image when CI is broken. If you
  must use `:latest`, treat "liveness 404 on `/healthz`" as the signature of a
  stale image — check when `:latest` was last built (`gh run list --workflow=ci.yml`).
- Always include a `startupProbe` so a slow-booting Nitro server isn't killed
  before it binds (liveness has no grace of its own once startup succeeds).
- The rule applies to **every** chart-managed image, not just the app
  container — e.g. the `curlimages/curl` sidecar used by the cron `CronJob`s
  (`deploy/helm/chmonitor/values.yaml` `cron.image`) must also pin an explicit
  tag with `IfNotPresent`. `rg -n ":latest|tag: \"latest\"" deploy/` should
  always return no results (#2902).

## Non-Helm deployments (raw manifests / Kustomize)

If you are **not** using the Helm chart, your Deployment `container` must include
all three probes against the right paths. Minimal correct block:

```yaml
containers:
  - name: chmonitor
    image: ghcr.io/chmonitor/chmonitor:0.2.10   # PIN a version, do not use :latest
    imagePullPolicy: IfNotPresent
    ports:
      - containerPort: 3000
    # ~60s grace before liveness can kill a slow boot
    startupProbe:
      httpGet: { path: /healthz, port: 3000 }
      initialDelaySeconds: 5
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 12
    # process-only — never gate on ClickHouse
    livenessProbe:
      httpGet: { path: /healthz, port: 3000 }
      periodSeconds: 15
      timeoutSeconds: 5
      failureThreshold: 3
    # readiness gates on ClickHouse; timeout MUST exceed CHM_HEALTHZ_TIMEOUT_MS (3s)
    readinessProbe:
      httpGet: { path: /api/healthz, port: 3000 }
      periodSeconds: 15
      timeoutSeconds: 10
      failureThreshold: 3
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits:   { cpu: 500m, memory: 512Mi }   # TanStack Start SSR needs headroom
```

### Common mistakes → symptom

| Mistake | Symptom |
|---------|---------|
| No `startupProbe` + slow boot | Liveness kills before bind → `BackOff` loop |
| `livenessProbe` → `/api/healthz` | CH outage kills pods → CrashLoopBackOff |
| `:latest` while CI is broken | Liveness `/healthz` → **404** (route missing in stale image) |
| `readinessProbe.timeoutSeconds` ≤ ping timeout | Readiness flaps on slow CH even when healthy |
| Memory limit < ~256Mi | OOMKilled during SSR → `BackOff` |

## Adopting the Helm chart instead (preferred)

The chart is published (OCI + GitHub Pages) and parameterizes all of the above.
See [deployment.md](deployment.md). The probe block is overridable under
`probes.{liveness,readiness,startup}` in `values.yaml` — you should not need raw
manifests. If a deployment predates the chart (its comment says "no official helm
chart"), migrate via the prompt below.

## Migration prompt (hand to an agent)

> Read `docs/knowledge/k8s-health-probes.md` in the clickhouse-monitoring repo.
> Then update this Deployment's container so it matches the chart's probe
> contract: add a `startupProbe` and `livenessProbe` to `/healthz`, point
> `readinessProbe` at `/api/healthz` with `timeoutSeconds: 10`, replace
> `image: …:latest` + `Always` with a pinned semver tag + `IfNotPresent`, and
> raise the memory limit to ≥ 512Mi. Do NOT point liveness at `/api/healthz`.
> After applying, run `kubectl rollout status deploy/<name>` and confirm
> `/healthz` returns 200 and `/api/healthz` returns 200 (or 503 if ClickHouse is
> intentionally down) — never 404.
