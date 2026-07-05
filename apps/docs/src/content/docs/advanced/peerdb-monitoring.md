---
title: "PeerDB Monitoring"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/advanced/peerdb-monitoring.mdx"
---

CHM includes an optional, **view-only** PeerDB section (Mirrors and Peers) that
surfaces replication status, throughput, lag, and per-mirror detail from a
[PeerDB](https://docs.peerdb.io) deployment. CHM never mutates PeerDB — it
proxies a read-only allowlist of the PeerDB REST API.

> Open it at `/peerdb` once configured. The section is hidden until
> `PEERDB_API_URL` is set.

---

## Enable

Set `PEERDB_API_URL` (and `PEERDB_PASSWORD` if your PeerDB API requires auth),
then restart the app.

```bash
## PeerDB UI behind NextAuth — include the /api suffix
PEERDB_API_URL=https://peerdb.example.com/api
PEERDB_PASSWORD=your-peerdb-ui-password

## OR a raw flow-api with no auth — use the bare origin
PEERDB_API_URL=http://localhost:8113
```

| Variable | Default | Description |
|---|---|---|
| `PEERDB_API_URL` | — | Base URL of the PeerDB REST API. For the PeerDB **UI** (NextAuth) include the `/api` suffix; for a raw **flow-api** use the bare origin (e.g. `http://host:8113`). |
| `PEERDB_PASSWORD` | — | Sent as HTTP Basic with an empty username (`base64(":" + password)`). Leave empty if the API has no auth. Server-side only — never sent to the browser. |
| `PEERDB_CACHE_TTL_MS` | `10000` | TTL for the server-side response cache (set `0` to disable). |
| `PEERDB_CACHE_MAX_ENTRIES` | `500` | Max cached responses before oldest entries are evicted. |
| `PEERDB_FETCH_TIMEOUT_MS` | `10000` | Upstream request timeout. |

See the full list in [Environment Variables](/reference/environment-variables).

---

## Connection status

The header shows a status pill that distinguishes:

- **Connected** — API reachable and authenticated.
- **Auth failed** — credentials rejected (check `PEERDB_PASSWORD`). For the
  PeerDB UI this is the **UI login password**.
- **Unreachable** — wrong `PEERDB_API_URL` or a network/DNS issue.
- **Not configured** — `PEERDB_API_URL` is unset.

---

## Security

CHM proxies only a **read-only allowlist** of PeerDB endpoints
(`app/api/v1/peerdb/[...slug]`). Mutating endpoints (create/drop/pause, alert
config, maintenance) are rejected with `403`. The PeerDB credential is attached
server-side and never reaches the browser bundle, and secret-shaped peer config
fields are masked in the UI.

The section also respects [Feature Permissions](/advanced/feature-permissions)
— gate it with `CHM_FEATURE_PEERDB_ACCESS=authenticated` or disable it with
`CHM_FEATURE_PEERDB_ENABLED=false`. The proxy enforces the same gate, so it
cannot be reached directly when the feature is disabled or restricted.

---

## Local development (mock)

To preview the full UI without a real PeerDB instance, run the bundled mock
server:

```bash
pnpm run peerdb:mock                                  # serves :8113
PEERDB_API_URL=http://localhost:8113 pnpm run dev     # → /peerdb
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Pill shows **Auth failed** | Wrong `PEERDB_PASSWORD`. For the PeerDB UI, use the UI login password; for a raw flow-api, match its configured password (or leave empty). |
| Pill shows **Unreachable** | `PEERDB_API_URL` host/port wrong, or the API is not reachable from the CHM server. |
| Mirrors load but charts are empty | The mirror has no recent CDC graph/batch data yet, or the PeerDB version doesn't expose those endpoints. |
| Large fleets show partial KPI totals | Per-row metrics load lazily above 24 mirrors; the Throughput/Rows-synced cards label how many mirrors are loaded. Expand a row to load its metrics. |
