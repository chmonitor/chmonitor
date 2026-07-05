# `apps/telemetry` — anonymous telemetry collector

The ingest endpoint that `CHM_TELEMETRY_ENDPOINT` points at. It receives the
anonymous instance ping (and optional aggregate events) emitted by
[`apps/dashboard/src/lib/telemetry`](../dashboard/src/lib/telemetry) and records
them to **Cloudflare Analytics Engine**.

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

## Storage layout (Analytics Engine `chm_telemetry`)

| column   | ping                | event                       |
|----------|---------------------|-----------------------------|
| `index1` | `instance_hash`     | event name                  |
| `blob1`  | `ping`              | `event`                     |
| `blob2`  | `deploy_target`     | event name                  |
| `blob3`  | `ch_version`        | `deploy_target`             |
| `blob4`  | —                   | `ch_version`                |
| `blob5`  | —                   | `ch_flavor`                 |
| `double1`| `1`                 | `1`                         |

## Deploy

```bash
cd apps/telemetry
pnpm install
pnpm run deploy            # production → telemetry.chmonitor.dev
pnpm run deploy:preview    # preview    → preview.telemetry.chmonitor.dev
```

No secrets required. The Analytics Engine dataset is created on first write.
CI deploys this automatically on push to `main` (see `.github/workflows/cloudflare.yml`).

### Optional: forever retention with D1

Analytics Engine keeps data for only **3 months**, then auto-deletes. To keep
metrics indefinitely (CF-native, free tier, no cron, no API token), attach D1 —
the worker then also writes one deduped row per install per UTC day, which D1
keeps forever:

```bash
cd apps/telemetry
wrangler d1 create chm_telemetry             # copy the database_id
# paste it into the commented [[d1_databases]] block in wrangler.toml, then:
wrangler d1 migrations apply chm_telemetry   # applies migrations/0001_init.sql
pnpm run deploy
```

The D1 write is a no-op until the binding exists, so deploying without D1 is safe
(AE-only). Query forever-retained installs:

```sql
SELECT day, deploy_target, ch_version, COUNT(*) AS installs
FROM ping_daily GROUP BY day, deploy_target, ch_version ORDER BY day DESC;
```

## Querying (active installs, by version / deploy target)

Analytics Engine is read via the SQL API with a Cloudflare API token that has
**Account Analytics: Read**:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d "
    SELECT
      blob2 AS deploy_target,
      blob3 AS ch_version,
      count(DISTINCT index1) AS active_installs
    FROM chm_telemetry
    WHERE blob1 = 'ping' AND timestamp > now() - INTERVAL '30' DAY
    GROUP BY deploy_target, ch_version
    ORDER BY active_installs DESC
  "
```

Total active installs in the last 30 days:
```sql
SELECT count(DISTINCT index1) AS active_installs
FROM chm_telemetry
WHERE blob1 = 'ping' AND timestamp > now() - INTERVAL '30' DAY
```

Event volume by name (when the event sink is wired):
```sql
SELECT blob2 AS event, sum(double1) AS n
FROM chm_telemetry
WHERE blob1 = 'event' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY event ORDER BY n DESC
```

> Note: Analytics Engine adaptively samples high-volume datasets. For a self-host
> telemetry volume this is effectively exact; if it ever samples, multiply
> `double1` sums by `_sample_interval` for unbiased counts. Distinct-install
> counts via `count(DISTINCT index1)` remain accurate because `index1` is the
> sampling key.

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
