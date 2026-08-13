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
| `extraEnv` | `[]` | Extra environment variables (e.g. `CLICKHOUSE_NAME`). |

See [`values.yaml`](./values.yaml) for the full list.

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
