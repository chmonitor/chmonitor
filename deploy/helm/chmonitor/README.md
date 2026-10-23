# chmonitor Helm chart

Production Helm chart for the [chmonitor](https://github.com/chmonitor/chmonitor)
dashboard. Vendored in-repo so the chart tracks the app it ships.

## Install

```bash
helm install my-chm ./deploy/helm/chmonitor \
  --set clickhouse.host="https://clickhouse.example.com:8443" \
  --set clickhouse.user="default" \
  --set clickhouse.password="<password>"
```

Upgrade:

```bash
helm upgrade my-chm ./deploy/helm/chmonitor -f my-values.yaml
```

Uninstall:

```bash
helm uninstall my-chm
```

## Values overview

| Key | Default | Description |
|---|---|---|
| `replicaCount` | `1` | Number of pod replicas (ignored when autoscaling is on). |
| `image.repository` | `ghcr.io/chmonitor/chmonitor` | Container image. |
| `image.tag` | `""` | Image tag; falls back to the chart `appVersion`. |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `service.type` | `ClusterIP` | Kubernetes Service type. |
| `service.port` | `3000` | Service port. |
| `containerPort` | `3000` | Container port the app listens on. |
| `resources` | requests 100m/256Mi, limits 500m/512Mi | Pod resource requests/limits. |
| `autoscaling.enabled` | `false` | Enable the HorizontalPodAutoscaler. |
| `autoscaling.minReplicas` | `1` | Min replicas when autoscaling. |
| `autoscaling.maxReplicas` | `10` | Max replicas when autoscaling. |
| `autoscaling.targetCPUUtilizationPercentage` | `80` | CPU target for autoscaling. |
| `ingress.enabled` | `false` | Enable the Ingress. |
| `clickhouse.host` | `http://localhost:8123` | Comma-separated ClickHouse host URLs (`CLICKHOUSE_HOST`). |
| `clickhouse.user` | `default` | Comma-separated usernames (`CLICKHOUSE_USER`). |
| `clickhouse.password` | `""` | Comma-separated passwords; stored in a Secret (`CLICKHOUSE_PASSWORD`). |
| `clickhouse.maxExecutionTime` | `"60"` | Query timeout in seconds (`CLICKHOUSE_MAX_EXECUTION_TIME`). Applied as a **session setting** on every query — the ClickHouse user must be allowed to change settings (see below). |
| `clickhouse.existingSecret` | `""` | Use an existing Secret (key `CLICKHOUSE_PASSWORD`) instead of `clickhouse.password`. |
| `auth.provider` | `""` | Auth provider: `""` / `none` / `clerk` / `proxy` / `trusted`. Sets `CHM_AUTH_PROVIDER`. |
| `auth.trusted.allowInsecure` | `false` | Trust forwarded headers with no shared secret (`CHM_TRUSTED_ALLOW_INSECURE`). Only safe on ClusterIP-isolated pods. |
| `auth.trusted.secret` | `""` | Shared secret the proxy must send (`CHM_TRUSTED_AUTH_SECRET`). Stored in the chart Secret. Preferred over `allowInsecure`. |
| `auth.trusted.existingSecret` | `""` | Existing Secret name with key `CHM_TRUSTED_AUTH_SECRET` (skips chart Secret creation for this key). |
| `auth.trusted.sharedSecretHeader` | `""` | Header carrying the shared secret. App default: `X-Chm-Proxy-Secret`. |
| `auth.trusted.userHeader` | `""` | Subject header. App default: `X-Forwarded-User`. |
| `auth.trusted.emailHeader` | `""` | Email header. App default: `X-Forwarded-Email`. |
| `auth.trusted.nameHeader` | `""` | Display-name header. App default: `X-Forwarded-Preferred-Username`. |
| `auth.trusted.avatarHeader` | `""` | Avatar-URL header. App default: `X-Forwarded-Avatar`. |
| `auth.trusted.groupsHeader` | `""` | Groups header (comma/space list). App default: `X-Forwarded-Groups`. |
| `auth.trusted.roleHeader` | `""` | Single-role header merged into groups. App default: `X-Forwarded-Role`. |
| `auth.trusted.customHeaders` | `""` | Comma list of `field:Header-Name` pairs for custom claims, e.g. `team:X-Forwarded-Team`. |
| `auth.trusted.allowedGroups` | `""` | Comma list of groups/roles required for access (`CHM_TRUSTED_ALLOWED_GROUPS`). |
| `alerting.instanceName` | `""` | Deployment label shown on every alert, e.g. `prod-eu` (`HEALTH_ALERT_INSTANCE_NAME`). |
| `alerting.dashboardUrl` | `""` | Public http(s) base URL of this dashboard; alerts link to `<url>/health?host=<id>` (`HEALTH_ALERT_DASHBOARD_URL`). |
| `alerting.metadata` | `{}` | Non-secret key/values added to alerts, rendered as JSON into `HEALTH_ALERT_METADATA`. Max 10 pairs, keys `[A-Za-z0-9_.-]{1,32}`, values up to 128 chars. |
| `queryAttribution.enabled` | `true` | Tag each ClickHouse query with app, version, signed-in user, host and source in `system.query_log.log_comment` (`CHM_QUERY_ATTRIBUTION`). |
| `queryAttribution.label` | `""` | Free-form deployment label in the record, e.g. `region=eu-west,env=prod` (`CHM_QUERY_ATTRIBUTION_LABEL`). |
| `queryAttribution.sqlComment` | `false` | Also prepend a `/* chmonitor ... */` comment, visible in `system.processes` (`CHM_QUERY_ATTRIBUTION_SQL_COMMENT`). |
| `queryAttribution.includeEmail` | `false` | Put the signed-in user's email in the record (`CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL`). |
| `imagePullSecrets` | `[]` | Pull secrets for the Deployment and cron Job pods. |
| `nameOverride` | `""` | Overrides the chart name used in resource names. |
| `fullnameOverride` | `""` | Overrides the full release-based resource name. |
| `image` | - | Group: `image.repository` (`ghcr.io/chmonitor/chmonitor`), `image.tag`, `image.pullPolicy`, rows above. |
| `podAnnotations` | `{}` | Annotations added to the pod template. |
| `podLabels` | `{}` | Labels added to the pod template. |
| `podSecurityContext` | - | Group: `podSecurityContext.runAsNonRoot`, `runAsUser`, `runAsGroup`, `fsGroup`. Rendered as-is into the pod spec. |
| `podSecurityContext.runAsNonRoot` | `true` | Require the pod to run as a non-root user. |
| `podSecurityContext.runAsUser` | `1001` | UID the pod runs as. Matches the non-root `app` user in the Docker runner stage. |
| `podSecurityContext.runAsGroup` | `1001` | GID the pod runs as. |
| `podSecurityContext.fsGroup` | `1001` | Group owning mounted volumes. |
| `securityContext` | - | Group: `securityContext.*` below. Rendered as-is into the container spec. |
| `securityContext.allowPrivilegeEscalation` | `false` | Blocks privilege escalation in the container. |
| `securityContext.readOnlyRootFilesystem` | `false` | Root filesystem is writable by default. Set `true` only if the app needs no writes outside mounted volumes. |
| `securityContext.runAsNonRoot` | `true` | Require a non-root container user. |
| `securityContext.runAsUser` | `1001` | Container UID. |
| `securityContext.runAsGroup` | `1001` | Container GID. |
| `securityContext.capabilities` | `drop: [ALL]` | Linux capabilities to drop. |
| `serviceAccount` | - | Group: `serviceAccount.create`, `serviceAccount.annotations`, `serviceAccount.name`. |
| `serviceAccount.create` | `true` | Create a ServiceAccount. When `false`, the pod uses `serviceAccount.name` or `default`. |
| `serviceAccount.annotations` | `{}` | Annotations on the created ServiceAccount. |
| `serviceAccount.name` | `""` | ServiceAccount name. Generated from the release fullname when empty and `create` is `true`. |
| `service` | - | Group: `service.type`, `service.port` (rows above). |
| `probes` | - | Group: `probes.liveness`, `probes.readiness`, `probes.startup`. Rendered into the container spec. See [Health probes](#health-probes). |
| `probes.liveness` | `enabled: true`, `/healthz`, period 15s, timeout 5s, failure threshold 3 | Static liveness probe. `/healthz` returns 200 while the process is up. |
| `probes.readiness` | `enabled: true`, `/api/healthz`, period 15s, timeout 10s, failure threshold 3 | Readiness probe. `/api/healthz` returns 503 when no ClickHouse host answers. Keep `timeoutSeconds` above the app ping timeout (`CHM_HEALTHZ_TIMEOUT_MS`, 3000 ms) or a slow host will flap readiness. |
| `probes.startup` | `enabled: true`, `/healthz`, initial delay 5s, period 5s, failure threshold 12 | Startup probe, about 60s grace before liveness can restart a slow boot. |
| `ingress` | - | Group: `ingress.enabled` (row above), `ingress.className`, `ingress.annotations`, `ingress.hosts`, `ingress.tls`. Rendered by `templates/ingress.yaml` when enabled. |
| `ingress.className` | `""` | IngressClass name (`spec.ingressClassName`). |
| `ingress.annotations` | `{}` | Annotations on the Ingress (for example, the Traefik middleware annotation in the auth walkthrough). |
| `ingress.hosts` | `chmonitor.local`, path `/` (`Prefix`) | Host and path rules. Each entry has `host` and `paths`. |
| `ingress.tls` | `[]` | TLS entries (`secretName`, `hosts`) passed to the Ingress. Non-empty TLS switches the NOTES output to `https`. |
| `resources.requests` | `cpu: 100m`, `memory: 256Mi` | Pod resource requests. |
| `resources.limits` | `cpu: 500m`, `memory: 512Mi` | Pod resource limits. |
| `autoscaling` | - | Group: `autoscaling.enabled` and the related rows above. Rendered by `templates/hpa.yaml`. |
| `clickhouse` | - | Group: `clickhouse.host`, `clickhouse.user`, `clickhouse.password`, `clickhouse.maxExecutionTime`, `clickhouse.existingSecret`. |
| `auth` | - | Group: `auth.provider`, `auth.clerk.*`, `auth.trusted.*`. Rendered into the Deployment env by `templates/deployment.yaml`. |
| `auth.clerk` | - | Group: `auth.clerk.publishableKey`, `auth.clerk.secretKey`, `auth.clerk.existingSecret`. |
| `auth.clerk.publishableKey` | `""` | Clerk publishable key (`pk_...`, public). Sets `CHM_CLERK_PUBLISHABLE_KEY` in the ConfigMap when set. |
| `auth.clerk.secretKey` | `""` | Clerk secret key (`sk_...`). Stored in the chart Secret as `CLERK_SECRET_KEY` unless `existingSecret` is set. |
| `auth.clerk.existingSecret` | `""` | Existing Secret with key `CLERK_SECRET_KEY`. When set, `secretKey` is ignored. |
| `auth.trusted` | - | Group: trusted-header auth settings. See [Authentication](#authentication-reverse-proxy--trusted-headers). |
| `features` | - | Group of non-secret `CHM_*` flags. Each non-empty key is rendered as-is into the ConfigMap. Empty values fall through to app defaults. |
| `features.CHM_CLOUD_MODE` | `""` | `"true"` turns env hosts into a public read-only demo and enables per-user workspaces (hosted SaaS). Empty means self-hosted. |
| `features.CHM_EDITION` | `""` | `community` (OSS, app default) or `enterprise`. |
| `features.CHM_FEATURE_AGENT_ACCESS` | `""` | AI agent access level: `public` (app default) or `authenticated`. |
| `features.CHM_FEATURE_CONVERSATION_DB` | `""` | `"true"` stores agent conversations in a DB instead of localStorage. App default: `false`. |
| `features.CHM_FEATURE_USER_CONNECTIONS_DB` | `""` | `"true"` persists per-user ClickHouse connections. Needs Clerk auth, `secrets.connectionsEncryptionKey`, and a DB backend (`DATABASE_URL` or `POSTGRES_URL` via `extraEnv`). App default: `false`. |
| `features.CHM_CLERK_PUBLIC_READ` | `""` | `"true"` allows anonymous `GET /api/v1/*` under Clerk. Writes still need sign-in. App default: `false`. |
| `features.CHM_DEVICE_LOGIN` | `""` | CLI device login: `auto`, `true`, or `false`. App default: `auto`. Set `"true"` to opt in on self-hosted. |
| `features.CHM_DEVICE_LOGIN_SUBJECT` | `""` | Subject for device-only tokens when `auth.provider` is `none`. App default: `self-hosted`. |
| `features.LLM_MODEL` | `""` | Default AI model (`provider:model` or `anyrouter/...`). Empty uses the app default. |
| `secrets` | - | Group: chart Secret inputs for the app. Rendered by `templates/secret.yaml`. |
| `secrets.connectionsEncryptionKey` | `""` | AES-256 key (32-byte base64) for encrypting per-user connection credentials. Required when `features.CHM_FEATURE_USER_CONNECTIONS_DB` is `"true"`. Stored as `CHM_USER_CONNECTIONS_ENCRYPTION_KEY`. |
| `secrets.apiKeySecret` | `""` | HMAC secret that gates `/api/v1/*` behind `chm_` Bearer tokens. Stored as `CHM_API_KEY_SECRET`. |
| `secrets.existingSecret` | `""` | Existing Secret with both `CHM_USER_CONNECTIONS_ENCRYPTION_KEY` and `CHM_API_KEY_SECRET`. When set, the two values above are ignored. |
| `cron` | - | Group: Kubernetes CronJobs that call `/api/cron/*`. Only needed on Node/Kubernetes. Cloudflare Workers uses `triggers.crons`. |
| `cron.enabled` | `false` | Create the three CronJobs (health sweep, retention prune, weekly report). |
| `cron.image` | `curlimages/curl:8.11.1`, `IfNotPresent` | Curl image for the Jobs. Pinned to a version on purpose; a mutable tag such as `latest` lets nodes diverge. |
| `cron.image.repository` | `curlimages/curl` | Image repository for the cron Jobs. |
| `cron.image.tag` | `"8.11.1"` | Image tag for the cron Jobs. Keep it pinned. |
| `cron.image.pullPolicy` | `IfNotPresent` | Pull policy for the cron Job image. |
| `cron.secret` | `""` | `CRON_SECRET` value, stored in the chart Secret. Must match the dashboard's `CRON_SECRET`. Ignored when `existingSecret` is set. |
| `cron.existingSecret` | `""` | Existing Secret with key `CRON_SECRET`. |
| `cron.schedules` | - | Group: schedules for the three CronJobs. |
| `cron.schedules.healthSweep` | `"*/5 * * * *"` | Health sweep schedule (every 5 minutes). |
| `cron.schedules.retentionPrune` | `"0 3 * * *"` | Retention prune schedule (daily at 03:00 UTC). |
| `cron.schedules.weeklyReport` | `"0 8 * * 1"` | Weekly report schedule (Mondays at 08:00 UTC). |
| `cron.resources` | requests 10m/16Mi, limits 100m/64Mi | Resources for the cron Job containers. |
| `alertWebhooks` | - | Group: GitOps-declared webhook targets for health alerts. See [Custom alert webhooks](#custom-alert-webhooks-gitops). |
| `alertWebhooks.enabled` | `false` | Render `targets` into `HEALTH_ALERT_WEBHOOK_TARGETS` and the chart Secret. |
| `alertWebhooks.defaults` | `format: auto`, `minSeverity: warning` | Defaults for targets that omit `format` or `minSeverity`. |
| `alertWebhooks.defaults.format` | `auto` | Default target format: `auto`, `raw`, `slack`, `matrix`, or `hookshot`. |
| `alertWebhooks.defaults.minSeverity` | `warning` | Default minimum severity: `warning` or `critical`. |
| `alertWebhooks.targets` | `[]` | List of webhook targets. Each has `name`, `url` or `urlFrom`, and optional `format`, `minSeverity`, headers, and templates. |
| `alerting` | - | Group: alert identity settings. See the `alerting.*` rows above. |
| `nodeSelector` | `{}` | Node selector for the Deployment and cron Job pods. |
| `tolerations` | `[]` | Tolerations for the Deployment and cron Job pods. |
| `affinity` | `{}` | Affinity rules for the Deployment and cron Job pods. |
| `extraEnv` | `[]` | Extra environment variables (e.g. `CLICKHOUSE_NAME`). |

See [`values.yaml`](./values.yaml) for the full list.

## Custom alert webhooks (GitOps)

The optional `alertWebhooks` block declares read-only alert destinations for the health sweep. It is disabled by default and is independent of the legacy `HEALTH_ALERT_WEBHOOK_URL` setting.

```yaml
alertWebhooks:
  enabled: true
  defaults:
    format: slack
    minSeverity: warning
  targets:
    - name: team-slack
      format: slack
      urlFrom:
        name: chmonitor-alert-secrets
        key: slack-webhook-url
    - name: element-room
      format: matrix
      minSeverity: critical
      urlFrom:
        name: chmonitor-alert-secrets
        key: matrix-webhook-url
      headersSecretFrom:
        name: chmonitor-alert-secrets
        key: matrix-headers
```

Supported formats are `auto`, `raw`, `slack`, `matrix` (Matrix `m.notice` event), and `hookshot` (matrix-hookshot generic webhook: `{text, html}`). Non-secret target metadata is rendered into the `HEALTH_ALERT_WEBHOOK_TARGETS` ConfigMap. URLs and secret headers are always mounted with `secretKeyRef`; do not put token-bearing URLs in ConfigMap values, `extraEnv`, or committed GitOps files. Prefer External Secrets, Sealed Secrets, or your cluster's secret manager for `urlFrom` and `headersSecretFrom`.

D1/UI configuration is owner-scoped and takes precedence over a Helm target with the same name. Deleting a D1 row resets that name to the Helm declaration. A disabled D1 row suppresses the Helm target until reset. Deploy-time schema and helper validation reject unknown formats, duplicate names, invalid URLs, oversized templates, and unsafe headers; the app repeats URL/SSRF and payload validation at send time.

The chart includes a values checksum for declarative changes. Rotating an externally managed Secret may require a normal pod rollout, as with other externally managed Secret references.

## Declarative alert config (health.d)

The dashboard reads alert definitions from a directory of YAML files, one per
concern: `alerts.yaml`, `routing.yaml`, `channels.yaml`, `quiet-hours.yaml`,
`maintenance.yaml`, `digest.yaml`. The path is `CHM_HEALTH_CONFIG_DIRECTORY`
(default `/etc/chmonitor/health.d`). The chart has no dedicated value for it
yet: create a ConfigMap and mount it at that path yourself, and set the env var
through `extraEnv` only if you use a different path.

Every entry needs its merge key (`id`, or `channel` for channel config).
Unknown keys, bad YAML, and entries without a key are skipped with a warning;
they never stop the pod. Do not put secrets in these files — reference an env
var name (`secretEnv`, `urlEnv`) backed by a `secretKeyRef` instead.

Definitions merge D1/Postgres > file > env > default. Declared entries are
read-only in the UI and a changed ConfigMap needs a pod restart. Declarative
config defines alerts but cannot acknowledge them: with no D1 or Postgres,
alert state is in memory (streaks and incident timers reset on restart) and ACK
is disabled. Full boundary table, per-concern YAML examples and the
end-to-end ConfigMap mount:
[Health](https://docs.chmonitor.dev/guide/features/health#run-alerts-without-a-metadata-database)
and [Kubernetes](https://docs.chmonitor.dev/operate/deploy/k8s#alert-definitions-from-a-configmap).

## ClickHouse user requirements

Prefer a **dedicated read-only user** with `SELECT` / `SHOW` (and usually
`dictGet`) on the databases you want to monitor — privilege-based, not the
server `readonly` settings profile.

| Do | Don't |
|---|---|
| `GRANT SELECT, SHOW ON *.* TO chmonitor` (or narrower) | Assign the ClickHouse **`readonly` profile** (`readonly=1`) |
| Use a normal / monitoring settings profile | Rely on profile `readonly` for “safety” |

**Why:** chmonitor sends `max_execution_time` (from `clickhouse.maxExecutionTime`)
as a session setting on every client connection. Users with `readonly=1` cannot
change settings, so queries fail with:

```text
Cannot modify 'max_execution_time' setting in readonly mode
```

That also makes readiness (`GET /api/healthz`) return 503 and the pod never
becomes Ready. Use grants for data isolation; keep a settings profile that
allows `max_execution_time`.

## Health probes

- **Liveness** — `GET /healthz` (static, always `200` while the process runs).
- **Readiness** — `GET /api/healthz` (returns `503` when no configured
  ClickHouse host is reachable, so traffic is only routed once a host is up).

## Authentication (reverse proxy / trusted headers)

The `trusted` auth provider lets a reverse proxy (e.g. Traefik + oauth2-proxy +
Dex) authenticate users and forward their identity as HTTP headers. chmonitor
reads those headers and trusts them — no Clerk account or API key needed.

> **Note on build-time vs runtime:** The published `ghcr.io/chmonitor/chmonitor`
> image is built with all auth providers compiled in. `auth.provider` (which sets
> `CHM_AUTH_PROVIDER` at runtime) is enough to switch providers — no rebuild
> required. The `VITE_AUTH_PROVIDER` build-time variable is baked into the
> image and must not be set in the Helm chart.

### Shared secret vs allowInsecure

| Mode | Value | When to use |
|---|---|---|
| Shared secret | `auth.trusted.secret: "<random>"` | **Recommended.** The proxy sends the secret in a request header; the app validates it with a constant-time compare before trusting identity headers. |
| Insecure | `auth.trusted.allowInsecure: true` | Only acceptable when the Service is `ClusterIP` and the pod is reachable **exclusively** through the ingress/oauth2-proxy path. No network-level guarantee = trust on the honour system. |

You can combine both: set a secret AND leave `allowInsecure` false (the default).
Do not set `allowInsecure: true` on a `NodePort` or `LoadBalancer` Service.

### Env vars set by this chart (reference)

| Env var | Source |
|---|---|
| `CHM_AUTH_PROVIDER` | `auth.provider` |
| `CHM_TRUSTED_ALLOW_INSECURE` | `auth.trusted.allowInsecure` (only when `true`) |
| `CHM_TRUSTED_AUTH_SECRET` | chart Secret / `auth.trusted.existingSecret` |
| `CHM_TRUSTED_SHARED_SECRET_HEADER` | `auth.trusted.sharedSecretHeader` |
| `CHM_TRUSTED_USER_HEADER` | `auth.trusted.userHeader` |
| `CHM_TRUSTED_EMAIL_HEADER` | `auth.trusted.emailHeader` |
| `CHM_TRUSTED_NAME_HEADER` | `auth.trusted.nameHeader` |
| `CHM_TRUSTED_AVATAR_HEADER` | `auth.trusted.avatarHeader` |
| `CHM_TRUSTED_GROUPS_HEADER` | `auth.trusted.groupsHeader` |
| `CHM_TRUSTED_ROLE_HEADER` | `auth.trusted.roleHeader` |
| `CHM_TRUSTED_CUSTOM_HEADERS` | `auth.trusted.customHeaders` |
| `CHM_TRUSTED_ALLOWED_GROUPS` | `auth.trusted.allowedGroups` |

All vars with empty values are omitted from the Deployment; the app uses its
built-in defaults. The default header names are the generic `X-Forwarded-*` set.

### Traefik + oauth2-proxy + Dex walkthrough

oauth2-proxy with `--set-xauthrequest=true` emits `X-Auth-Request-*` headers
(not the generic `X-Forwarded-*` defaults). Traefik's ForwardAuth Middleware
must copy them back via `authResponseHeaders`. The chart header overrides map
the two naming schemes together.

**Step 1 — oauth2-proxy** (relevant flags):

```
--provider=oidc
--oidc-issuer-url=https://dex.example.com
--set-xauthrequest=true
--scope=openid profile email groups
--email-domain=*
```

**Step 2 — Traefik Middleware** (apply to the same namespace as chmonitor):

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: oauth2-proxy-auth
  namespace: chmonitor
spec:
  forwardAuth:
    address: http://oauth2-proxy.auth.svc.cluster.local/oauth2/auth
    authResponseHeaders:
      - X-Auth-Request-User
      - X-Auth-Request-Email
      - X-Auth-Request-Preferred-Username
      - X-Auth-Request-Groups
```

**Step 3 — values.yaml**:

```yaml
auth:
  provider: trusted
  trusted:
    # Generate with: openssl rand -hex 32
    secret: "change-me-strong-random-value"

    # Map oauth2-proxy's X-Auth-Request-* headers (not the X-Forwarded-* defaults)
    userHeader:   "X-Auth-Request-User"
    emailHeader:  "X-Auth-Request-Email"
    nameHeader:   "X-Auth-Request-Preferred-Username"
    groupsHeader: "X-Auth-Request-Groups"

    # Optional: only members of these Dex groups can access chmonitor
    allowedGroups: "chmonitor-admins,platform-team"

ingress:
  enabled: true
  className: traefik
  annotations:
    # Reference: <namespace>-<middleware-name>@kubernetescrd
    traefik.ingress.kubernetes.io/router.middlewares: chmonitor-oauth2-proxy-auth@kubernetescrd
  hosts:
    - host: chmonitor.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - hosts:
        - chmonitor.example.com
      secretName: chmonitor-tls
```

**Step 4 — install**:

```bash
helm install my-chm ./deploy/helm/chmonitor -f my-values.yaml
```

### Using a pre-existing Secret for the trusted auth secret

If you manage secrets externally (e.g. via External Secrets Operator or Vault):

```yaml
auth:
  provider: trusted
  trusted:
    existingSecret: my-chmonitor-secrets   # must contain key: CHM_TRUSTED_AUTH_SECRET
```

The chart will not create a Secret entry for the trusted auth key; it will
mount it from your existing Secret.

### Group-gating

`auth.trusted.allowedGroups` (sets `CHM_TRUSTED_ALLOWED_GROUPS`) takes a
comma-separated list of group or role names. Matching is case-insensitive.
The user's forwarded groups (from `groupsHeader`) and role (from `roleHeader`)
are merged and checked against this list. If the intersection is empty, the
request is denied with 403.

This works on top of the existing per-feature env vars:
`CHM_FEATURE_<ID>_ACCESS`, `CHM_AUTH_REQUIRED_FEATURES`,
`CHM_DISABLED_FEATURES`, and `CHM_API_KEY_SECRET` (set via `extraEnv`).

## Security

Pods run as the non-root `app` user (uid/gid `1001`) baked into the Docker
runner stage, with `allowPrivilegeEscalation: false` and all Linux capabilities
dropped.
