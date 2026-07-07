# `apps/telemetry` — anonymous telemetry collector

The ingest endpoint that `CHM_TELEMETRY_ENDPOINT` points at. It receives the
anonymous instance ping (and optional aggregate events) emitted by
[`apps/dashboard/src/lib/telemetry`](../dashboard/src/lib/telemetry) and records
them to **Cloudflare D1** (forever retention, free tier).

This closes the gap described in
[`docs/content/operate/advanced/telemetry.mdx`](../../docs/content/operate/advanced/telemetry.mdx):
the dashboard already builds and (when enabled) sends the ping, but until now no
endpoint existed to receive it. `track()` events still need a client-side sink
registered before they flow — see *Follow-ups* below.

## What it accepts

Public, write-only. No auth (it cannot be read back over HTTP — only the
project's Cloudflare account can query the dataset). Everything is validated
against a closed shape; unknown fields are ignored.

### `POST /v1/ping`
```json
{ "instance_hash": "<64-char sha256 hex>", "deploy_target": "docker", "ch_version": "24.8" }
```
- `instance_hash` — required, must be 64-char lowercase hex. Opaque per-install
  id (SHA-256 of a random local UUID). Used only to count distinct installs.
- `deploy_target` — one of `docker | helm | cf | dev | unknown` (else `unknown`).
- `ch_version` — optional, `MAJOR.MINOR` only (e.g. `24.8`); anything else dropped.

### `POST /v1/event`
```json
{ "event": "cluster_connected", "props": { "deploy_target": "docker", "ch_version": "24.8", "ch_flavor": "oss" } }
```
- `event` — one of the five names in `TELEMETRY_EVENTS` (else rejected).
- `props` — only `deploy_target`, `ch_version`, `ch_flavor` are stored.

### `GET /` or `/health`
Returns `200` — liveness only.

## Storage layout (D1 `chm_telemetry`)

### `ping_daily` table
| column        | type    | description |
|---------------|---------|-------------|
| `day`         | TEXT    | `YYYY-MM-DD` (UTC) |
| `instance_hash` | TEXT  | SHA-256 install id |
| `deploy_target` | TEXT  | docker/helm/cf/dev/unknown |
| `ch_version`  | TEXT    | MAJOR.MINOR or NULL |
| `ch_flavor`   | TEXT    | oss/altinity/cloud/unknown |
| `country`     | TEXT    | ISO 3166-1 alpha-2 or NULL |
| `platform`    | TEXT    | windows/macos/linux/android/ios/unknown |
| `chm_version` | TEXT    | semver-like CHM version |
| `install_place` | TEXT  | deployment environment hash |

Primary key: `(day, instance_hash)` — one row per install per day.

### `events` table
| column        | type    | description |
|---------------|---------|-------------|
| `id`          | INTEGER | auto-increment |
| `day`         | TEXT    | `YYYY-MM-DD` (UTC) |
| `event`       | TEXT    | event name |
| `deploy_target` | TEXT  | docker/helm/cf/dev/unknown |
| `ch_version`  | TEXT    | MAJOR.MINOR or NULL |
| `ch_flavor`   | TEXT    | oss/altinity/cloud/unknown |
| `created_at`  | TEXT    | datetime('now') |

## Deploy

```bash
cd apps/telemetry
pnpm install
pnpm run deploy            # production → telemetry.chmonitor.dev
pnpm run deploy:preview    # preview    → preview.telemetry.chmonitor.dev
```

No secrets required. The D1 database is created on first deploy.
CI deploys this automatically on push to `main` (see `.github/workflows/cloudflare.yml`).

## Querying (active installs, by version / deploy target)

D1 is queried via the Cloudflare REST API or the `/v1/summary` endpoint:

```bash
curl "https://telemetry.chmonitor.dev/v1/summary"
```

Or query D1 directly:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database/$D1_DATABASE_ID/raw" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d '{"sql":"SELECT deploy_target, COUNT(DISTINCT instance_hash) AS installs FROM ping_daily GROUP BY deploy_target"}'
```

## Migrating from Analytics Engine

If you previously used Analytics Engine, run the one-time migration script:

```bash
CF_ACCOUNT_ID=<your-account-id> CF_API_TOKEN=<your-api-token> bun scripts/migrate-ae-to-d1.ts
```

This pulls all historical data from AE into D1 (last 90 days).

## On by default; how to opt out

Telemetry is **on by default**. The endpoint defaults to this collector
(`https://telemetry.chmonitor.dev/v1/ping`) and is overridable via env. Users opt
out with any of:

```bash
CHM_TELEMETRY=off              # also 0 / false / no
DO_NOT_TRACK=1                 # cross-tool opt-out standard
CHM_TELEMETRY_ENDPOINT=""      # hard kill-switch: no endpoint, no network call
```

The client also makes zero calls in SSR/prerender/non-browser contexts. See
[`config.ts`](../dashboard/src/lib/telemetry/config.ts) and
[`instance-ping.ts`](../dashboard/src/lib/telemetry/instance-ping.ts).

## Follow-ups (not in this collector)

1. **Send `ch_version` in the ping** — `maybePingInstance()` currently passes
   `version: undefined`; thread the connected cluster's version through for a
   per-version install breakdown. (The `cluster_connected` event already carries
   `ch_version` in its props, so version data already flows via `/v1/event`.)
