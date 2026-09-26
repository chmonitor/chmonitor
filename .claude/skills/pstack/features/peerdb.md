# PeerDB agent, metrics, and alerts

PeerDB monitoring is a read-only integration. The user can inspect connection
status and fleet health, ask the agent for mirror triage, and receive PeerDB
insights or alerts. Mutating PeerDB operations are outside the surface.

## Sub-features

- `peerdb-status` reports configured, connected, auth-failed, unreachable, or
  not-configured state without exposing credentials.
- `peerdb-metrics` summarizes mirrors, peers, slots, rows synced, lag, and
  partial failures for the dashboard.
- `peerdb-proxy` allows only the fixed read-only PeerDB path and method set.
- `peerdb-auth` supports open, empty-user Basic, and Bearer configurations
  without putting a secret in the URL or browser payload.
- `peerdb-connection` selects an owned per-user connection and fails closed
  when the selector is unknown or unowned.
- `peerdb-cache` caches only env-wide metrics. Per-connection responses are
  re-fetched and never served from the shared cache.
- `peerdb-agent` exposes `get_peerdb_mirror_status` (per-mirror fleet/detail
  status) and `get_peerdb_metrics` (slot lag + lag history, CDC rows-synced
  throughput, snapshot progress, per-peer queries, fleet aggregates) only when
  `CHM_FEATURE_PEERDB_AGENT=true` and the PeerDB feature is not disabled.
- `peerdb-insights-alerts` classifies failed, paused, lagging, noisy, and
  stalled mirrors and feeds the health-sweep path.

## How to get to it (user POV)

- Open `/peerdb` for mirrors and `/peerdb/peers` for peer and slot state when
  the `peerdb` feature is available.
- Add `?connection=<id>` only when a signed-in user owns that connection. The
  browser must never be given the PeerDB secret.
- In the agent chat, ask which mirrors are lagging or failing (answered by
  `get_peerdb_mirror_status`), or which replication slot lags worst, whether it
  is recovering, how fast rows are syncing, or how far along the snapshot is
  (answered by `get_peerdb_metrics`). Both are read-only diagnostics, not
  control operations.
- Read PeerDB insights from the Insights surface and observe health-sweep
  behavior only in an approved configured environment.

## Driving it with CI

Preconditions:

- Normal CI does not provide a real PeerDB service, URL, or credential.
- The `scripts/peerdb-mock-server.ts` file is a documented test double with
  static data; it does not validate authentication and is not a live proof.

- **Status, auth, and cache isolation.** In `.github/workflows/test.yml`, job
  `unit-tests`, inspect `apps/dashboard/src/lib/peerdb/peerdb-auth.test.ts`,
  `peerdb-config.test.ts`, the API route tests, and
  `routes/api/v1/__tests__/peerdb-metrics.cache-isolation.test.ts`. The
  observable contract is configured/not-configured output, auth header parity,
  fail-closed ownership, and no cross-user cache hit.
- **Proxy and agent safety.** Inspect the unit coverage for
  `routes/api/v1/peerdb/$.ts`, `routes/api/v1/peerdb/validate.ts`,
  `lib/ai/agent/tools/__tests__/peerdb-tools.test.ts`, and
  `peerdb-tools-gate.test.ts`. Assert the allowlist, name validation, bounded
  output, config stripping, and flag gate. The metrics tests assert the
  fleet aggregate, slot-lag classification/trend, CDC throughput,
  initial-load progress, and that a `peer_stats` result never contains the
  `peer.config` block.
- **Metrics and insights.** Inspect `lib/insights/peerdb-checks.test.ts` and
  `peerdb-collectors.test.ts` in the same unit job. They cover thresholds,
  hostile-reader degradation, Basic/Bearer parity, and unconfigured silence.
- **Agent behavior.** `.github/workflows/agent-eval.yml` runs only for its
  prompt, skill, and eval path filter and is informational. It is not a
  substitute for the PeerDB tool unit tests and may be skipped when live
  credentials are absent.
- **Live configured path.** Only claim a connected PeerDB result when a named
  CI/deployment environment supplied `PEERDB_API_URL` and the corresponding
  auth configuration. Otherwise report the unconfigured or unreachable state
  as the expected observation, not as a successful live integration.
- **Evidence.** Record whether the proof was mocked, mock-server-backed, or
  live, plus the exact endpoint/tool and the resulting fleet summary. Do not
  record the URL secret or a raw authorization header.

## Gotchas

- `GET /api/v1/peerdb-status` can return HTTP `200` with a structured
  `auth` or `unreachable` state. HTTP success alone is not a connected result.
- `GET /api/v1/peerdb-metrics` can be `partial` when an individual mirror or
  peer fails. Preserve that distinction in the evidence.
- An explicit `?connection=` selector must never silently fall back to the
  env-wide source when ownership fails.
- The agent tools are absent unless the exact feature flag is `true`; values
  such as `1` do not enable them.
- PeerDB connector configuration can contain secrets. The agent result must
  not contain the raw `cdcStatus` or `qrepStatus` config blocks, nor a
  `peers/info` peer `config` block.
- Every model-supplied name is a *validated identifier*, not a path fragment:
  `assertValidMirrorName` / `assertValidPeerName` / `assertValidSlotName`
  reject slashes, `?#`, whitespace, and control chars, and the name that
  reaches a URL is additionally `encodeURIComponent`-ed. A new PeerDB tool must
  reuse these rather than interpolating a name into a path.
- Fleet/peer fan-outs are capped and best-effort: a missing endpoint yields
  `partial: true` plus a `failures` entry, never a thrown error, so one
  unavailable PeerDB version does not blind the whole fleet view.
- Fleet aggregation is NOT reimplemented in the agent tool. Both the
  `peerdb-metrics` API route and `get_peerdb_metrics` call the pure
  `summarizePeerDBFleet` (`lib/peerdb/fleet-metrics.ts`), so the agent and the
  fleet page cannot report different status buckets or a different worst-slot
  lag. Same rule as slot thresholds: reuse `SLOT_LAG_WARN_MB` /
  `SLOT_LAG_CRITICAL_MB` from `lib/peerdb/slot-lag-thresholds.ts` instead of
  hardcoding a "lagging" number.
- The read-only proxy accepts selected POST endpoints because those endpoints
  are status or history reads. It does not make arbitrary PeerDB mutations
  reachable.
- The mock server is useful for UI shape exploration, but it proves neither
  authentication nor upstream behavior.
